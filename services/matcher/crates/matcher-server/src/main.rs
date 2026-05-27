//! BUFI matcher server.
//!
//! Phase 3c — Rust matcher replaces `apps/keeper-perps-matcher` (TS).
//! Single tokio binary that:
//!
//!   1. Loads `bufi_perps_db::PerpsDb` against the bun:sqlite DB the TS
//!      keeper used to share (no schema change).
//!   2. Loads `bufi_perps_onchain::PerpsOnchain` from
//!      `fx-telarana/deployments/perp-stack-{chainId}.json` + env.
//!   3. Spawns the adaptive tick loop (`tick::run`) which polls + matches +
//!      settles + records + emits replacement events.
//!   4. Spawns the HTTP event poller (`event_subscriber::EventSubscriber`).
//!   5. Sits in `tokio::select!` between the two, plus SIGTERM/SIGINT.

#![forbid(unsafe_code)]

use std::process::ExitCode;
use std::sync::Arc;

use tokio::signal;
use tokio::sync::broadcast;
use tracing::{error, info};

use bufi_perps_db::PerpsDb;
use bufi_perps_onchain::{PerpsDeployment, PerpsOnchain};

use crate::funding_poker::FundingPoker;
use crate::insurance_fund::InsuranceFundWatchdog;
use crate::lp_signer::LpSigner;
use crate::lp_state::PathALpStateView;

mod batch_flusher;
mod arcade_settler;
mod book_wal;
mod canary;
mod config;
mod event_subscriber;
mod expiry_sweeper;
mod funding_poker;
mod gateway_signer;
mod grpc;
mod http_health;
mod insurance_fund;
mod intent_translator;
mod lp_router;
mod lp_signer;
mod lp_state;
mod oi_gate;
mod perps_liquidator;
mod price;
mod pyth_pusher;
mod pyth_pusher_ws;
mod realtime;
mod replacement_events;
mod sequencer;
mod settlement;
mod spot_executor;
mod telarana_liquidator;
mod tick;
mod ws_gateway;

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing();
    info!(
        version = env!("CARGO_PKG_VERSION"),
        "BUFI matcher server starting"
    );

    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            error!(error = ?e, "config: aborting");
            return ExitCode::FAILURE;
        }
    };
    let signer_key = match cfg.require_signer() {
        Ok(k) => k.to_string(),
        Err(e) => {
            error!(error = ?e, "signer: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- DB ----------
    let db_path = cfg.db_path.to_string_lossy().into_owned();
    let db = match PerpsDb::open(&db_path).await {
        Ok(db) => db,
        Err(e) => {
            error!(path = db_path, error = ?e, "open DB: aborting");
            return ExitCode::FAILURE;
        }
    };
    info!(path = db_path, "DB opened");

    // ---------- Deployment ----------
    let dir = cfg
        .fx_telarana_deployments_dir
        .clone()
        .unwrap_or_else(bufi_perps_onchain::env::fx_telarana_deployments_dir);
    let deployment = match PerpsDeployment::load_from_dir(&dir, cfg.chain_id) {
        Ok(d) => d,
        Err(e) => {
            error!(dir = ?dir, chain_id = cfg.chain_id, error = ?e, "load deployment: aborting");
            return ExitCode::FAILURE;
        }
    };
    info!(
        chain_id = deployment.chain_id,
        order_settlement = format!("{:#x}", deployment.contracts.fx_order_settlement),
        clearinghouse = format!("{:#x}", deployment.contracts.fx_perp_clearinghouse),
        "deployment loaded"
    );

    // ---------- On-chain client ----------
    let onchain = match PerpsOnchain::new(&cfg.rpc_url, &signer_key, deployment) {
        Ok(c) => c,
        Err(e) => {
            error!(error = ?e, "build PerpsOnchain: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- LP signer + state view (Phase 4 backstop) ----------
    let lp_signer = match cfg.lp_operator_key_hex.as_deref() {
        Some(key) => match LpSigner::from_hex(key) {
            Ok(s) => {
                info!(lp_operator = ?s.address(), "LP backstop enabled (Phase 4 Path A)");
                Some(s)
            }
            Err(e) => {
                error!(error = ?e, "LP_OPERATOR_PRIVATE_KEY parse: aborting");
                return ExitCode::FAILURE;
            }
        },
        None => {
            info!("LP backstop disabled (no LP_OPERATOR_PRIVATE_KEY set)");
            None
        }
    };
    let lp_state = lp_signer.as_ref().map(|_| PathALpStateView::new(db.clone()));

    // ---------- Event subscriber ----------
    let subscriber = Arc::new(event_subscriber::EventSubscriber::new(&cfg, &deployment));
    let subscriber_handle = tokio::spawn(async move { subscriber.run().await });

    // ---------- Insurance-fund watchdog (Phase 4 invariant 6) ----------
    let if_handle = {
        let wd = InsuranceFundWatchdog::new(db.clone());
        tokio::spawn(async move { wd.run().await })
    };

    // ---------- Funding poker (Phase 5) ----------
    let funding_handle = {
        let poker = FundingPoker::new(onchain.clone(), &cfg);
        tokio::spawn(async move { poker.run().await })
    };

    // Shared Pyth tick channel. The Pyth pusher owns the Hermes WS stream;
    // consumers subscribe here instead of opening duplicate sockets.
    let (pyth_price_tx, _) = broadcast::channel(1024);

    // ---------- Pyth pusher (Phase 7.2 — unblocks LP oracle gate) ----------
    let pyth_handle = match pyth_pusher::PythPusher::new(
        onchain.clone(),
        &cfg,
        Some(pyth_price_tx.clone()),
    ) {
        Ok(Some(pusher)) => {
            info!("pyth pusher enabled (Phase 7.2)");
            Some(tokio::spawn(async move { pusher.run().await }))
        }
        Ok(None) => {
            info!("pyth pusher disabled (no MATCHER_FUNDING_MARKET_IDS configured)");
            None
        }
        Err(e) => {
            error!(error = ?e, "pyth pusher boot: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- Perps liquidator (Hookathon Phase 6) ----------
    let liquidator_handle = match perps_liquidator::PerpsLiquidator::new(
        onchain.clone(),
        &cfg,
        &dir,
        pyth_price_tx.subscribe(),
    ) {
        Ok(Some(liquidator)) => {
            info!("perps liquidator enabled (Hookathon Phase 6)");
            Some(tokio::spawn(async move { liquidator.run().await }))
        }
        Ok(None) => {
            info!("perps liquidator disabled (LIQUIDATOR_ENABLED not true)");
            None
        }
        Err(e) => {
            error!(error = ?e, "perps liquidator boot: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- Telarana liquidator (Rust keeper consolidation) ----------
    let telarana_liquidator_handle = match telarana_liquidator::TelaranaLiquidator::new(&cfg, &signer_key) {
        Ok(Some(liquidator)) => {
            info!("telarana liquidator enabled (Rust keeper consolidation)");
            Some(tokio::spawn(async move { liquidator.run().await }))
        }
        Ok(None) => {
            info!("telarana liquidator disabled (TELARANA_LIQUIDATOR_ENABLED=false)");
            None
        }
        Err(e) => {
            error!(error = ?e, "telarana liquidator boot: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- Spot executor / gateway signer / arcade settler ----------
    let spot_executor_handle = match spot_executor::SpotExecutor::new(&cfg, &signer_key) {
        Ok(Some(executor)) => {
            info!("spot executor enabled (Rust keeper consolidation)");
            Some(tokio::spawn(async move { executor.run().await }))
        }
        Ok(None) => {
            info!("spot executor disabled (SPOT_EXECUTOR_ENABLED=false)");
            None
        }
        Err(e) => {
            error!(error = ?e, "spot executor boot: aborting");
            return ExitCode::FAILURE;
        }
    };
    let gateway_signer_handle = match gateway_signer::GatewaySigner::new(&cfg, &signer_key) {
        Ok(Some(signer)) => {
            info!("gateway signer enabled (Rust keeper consolidation)");
            Some(tokio::spawn(async move { signer.run().await }))
        }
        Ok(None) => {
            info!("gateway signer disabled (GATEWAY_SIGNER_ENABLED=false)");
            None
        }
        Err(e) => {
            error!(error = ?e, "gateway signer boot: aborting");
            return ExitCode::FAILURE;
        }
    };
    let arcade_settler_handle = match arcade_settler::ArcadeSettler::new(&cfg, &signer_key) {
        Ok(Some(settler)) => {
            info!("arcade settler enabled (Rust keeper consolidation)");
            Some(tokio::spawn(async move { settler.run().await }))
        }
        Ok(None) => {
            info!("arcade settler disabled (ARCADE_SETTLER_ENABLED=false)");
            None
        }
        Err(e) => {
            error!(error = ?e, "arcade settler boot: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- Canary keeper (Phase 7) ----------
    let canary_handle = match canary::Canary::new(
        db.clone(),
        deployment,
        cfg.canary_trader_key_hex.as_deref(),
        cfg.signer_key_hex.as_deref(),
        cfg.lp_operator_key_hex.as_deref(),
        cfg.canary_interval,
        cfg.canary_timeout,
        cfg.canary_market_id,
        cfg.canary_notional_usdc_e6,
    ) {
        Ok(Some(canary)) => {
            info!(
                canary_trader = ?canary.trader_address(),
                "canary keeper enabled (Phase 7)"
            );
            Some(tokio::spawn(async move { canary.run().await }))
        }
        Ok(None) => {
            info!("canary keeper disabled (no CANARY_TRADER_PRIVATE_KEY set)");
            None
        }
        Err(e) => {
            error!(error = ?e, "canary keeper boot: aborting");
            return ExitCode::FAILURE;
        }
    };

    // ---------- gRPC server (Phase 8) ----------
    let grpc_state = std::sync::Arc::new(grpc::GrpcState::new());
    let grpc_handle = if cfg.grpc_bind.is_empty() {
        info!("gRPC server disabled (MATCHER_GRPC_BIND empty)");
        None
    } else {
        match cfg.grpc_bind.parse::<std::net::SocketAddr>() {
            Ok(addr) => {
                info!(bind = %addr, version = env!("CARGO_PKG_VERSION"), "gRPC server starting (Phase 8)");
                // Phase 8d — plumb the chain backend so SubmitOrder +
                // CancelOrder can run end-to-end against the same DB
                // and on-chain endpoint the tick loop uses. The
                // matching_lock on GrpcState serializes match/settle
                // between both.
                let chain = grpc::ChainBackend {
                    db: db.clone(),
                    onchain: onchain.clone(),
                    deployment,
                    chain_id: cfg.chain_id as i64,
                };
                let svc = grpc::MatcherService::with_chain(grpc_state.clone(), chain);
                Some(tokio::spawn(async move {
                    if let Err(e) = tonic::transport::Server::builder()
                        .add_service(svc.into_server())
                        .serve(addr)
                        .await
                    {
                        error!(error = ?e, "gRPC server exited with error");
                    }
                }))
            }
            Err(e) => {
                error!(bind = %cfg.grpc_bind, error = ?e, "MATCHER_GRPC_BIND parse: aborting");
                return ExitCode::FAILURE;
            }
        }
    };

    // ---------- HTTP /health server (Phase 8.5a) ----------
    let http_handle = if cfg.http_bind.is_empty() {
        info!("HTTP /health server disabled (MATCHER_HTTP_BIND empty)");
        None
    } else {
        match cfg.http_bind.parse::<std::net::SocketAddr>() {
            Ok(addr) => {
                info!(bind = %addr, "HTTP /health server starting (Phase 8.5a)");
                let state = http_health::HttpHealthState {
                    grpc: grpc_state.clone(),
                    db: db.clone(),
                    version: env!("CARGO_PKG_VERSION"),
                    ready_max_tick_age_ms: cfg.ready_max_tick_age.as_millis() as u64,
                };
                Some(tokio::spawn(async move {
                    if let Err(e) = http_health::serve(addr, state).await {
                        error!(error = ?e, "HTTP /health server exited with error");
                    }
                }))
            }
            Err(e) => {
                error!(bind = %cfg.http_bind, error = ?e, "MATCHER_HTTP_BIND parse: aborting");
                return ExitCode::FAILURE;
            }
        }
    };

    // ---------- Realtime publisher (Phase 8.5b) ----------
    let realtime_handle = realtime::spawn(
        grpc_state.clone(),
        realtime::RealtimeConfig {
            redis_url: cfg.redis_url.clone(),
            channel_prefix: cfg.redis_channel_prefix.clone(),
        },
    );

    // ---------- Sequencer + Batch Flusher (Phase 2) ----------
    let (fill_tx, fill_rx) = tokio::sync::mpsc::unbounded_channel();
    let (seq_tx, seq_rx) = tokio::sync::mpsc::channel::<sequencer::SequencerCommand>(1024);

    let seq_grpc = grpc_handle.as_ref().map(|_| grpc_state.clone());
    let seq = sequencer::Sequencer::new(fill_tx, seq_grpc);
    let sequencer_handle = tokio::spawn(async move { seq.run(seq_rx).await });

    let flusher_grpc = grpc_handle.as_ref().map(|_| grpc_state.clone());
    let flusher = batch_flusher::BatchFlusher::new(
        db.clone(),
        onchain.clone(),
        batch_flusher::BatchFlusherConfig {
            interval: std::time::Duration::from_millis(cfg.batch_interval_ms),
            max_fills: cfg.batch_max_fills,
        },
        flusher_grpc,
    );
    let flusher_handle = tokio::spawn(async move { flusher.run(fill_rx).await });

    // ---------- WS Gateway (Phase 2) ----------
    let ws_handle = if cfg.ws_bind.is_empty() {
        info!("WS gateway disabled (MATCHER_WS_BIND empty)");
        None
    } else {
        match cfg.ws_bind.parse::<std::net::SocketAddr>() {
            Ok(addr) => {
                let ws_state = ws_gateway::WsState {
                    seq_tx: seq_tx.clone(),
                    deployment: Arc::new(deployment),
                };
                Some(tokio::spawn(async move {
                    if let Err(e) = ws_gateway::serve(addr, ws_state).await {
                        error!(error = ?e, "WS gateway exited with error");
                    }
                }))
            }
            Err(e) => {
                error!(bind = %cfg.ws_bind, error = ?e, "MATCHER_WS_BIND parse: aborting");
                return ExitCode::FAILURE;
            }
        }
    };

    // ---------- Tick loop (legacy fallback — kept for non-WS deployments) ----------
    let tick_cfg = cfg.clone();
    let tick_db = db.clone();
    let tick_onchain = onchain.clone();
    let tick_deployment = deployment;
    let tick_grpc_state = grpc_handle.as_ref().map(|_| grpc_state.clone());
    let tick_handle = if cfg.ws_bind.is_empty() {
        // No WS gateway — tick loop is the primary matching path.
        Some(tokio::spawn(async move {
            tick::run(
                tick_db,
                tick_onchain,
                tick_deployment,
                tick_cfg,
                lp_signer,
                lp_state,
                tick_grpc_state,
            )
            .await
        }))
    } else {
        // WS gateway active — sequencer handles matching.
        // Tick loop is disabled; expiry sweeper takes over.
        info!("tick loop disabled (MATCHER_WS_BIND set; sequencer is primary)");
        None
    };

    // ---------- Expiry sweeper (Phase 4) ----------
    let sweeper_handle = if !cfg.ws_bind.is_empty() {
        let sweeper = expiry_sweeper::ExpirySweeper::new(
            db.clone(),
            expiry_sweeper::ExpirySweeperConfig {
                chain_id: cfg.chain_id as i64,
                interval: cfg.tick_idle,
            },
            grpc_handle.as_ref().map(|_| grpc_state.clone()),
        );
        Some(tokio::spawn(async move { sweeper.run().await }))
    } else {
        None
    };

    // ---------- Book WAL (Phase 5) ----------
    let wal_handle = if !cfg.ws_bind.is_empty() {
        if let Some(gs) = grpc_handle.as_ref().map(|_| grpc_state.clone()) {
            let wal_cfg = book_wal::BookWalConfig::from_db_path(&cfg.db_path);
            let wal = book_wal::BookWal::new(wal_cfg, gs);
            Some(tokio::spawn(async move { wal.run().await }))
        } else {
            None
        }
    } else {
        None
    };

    // ---------- Shutdown ----------
    let canary_future = async {
        match canary_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "canary keeper exited unexpectedly");
            }
            None => {
                // No canary configured — park forever so this arm never
                // fires and the other branches drive shutdown.
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(canary_future);
    let pyth_future = async {
        match pyth_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "pyth pusher exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(pyth_future);
    let liquidator_future = async {
        match liquidator_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "perps liquidator exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(liquidator_future);
    let telarana_liquidator_future = async {
        match telarana_liquidator_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "telarana liquidator exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(telarana_liquidator_future);
    let spot_executor_future = async {
        match spot_executor_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "spot executor exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(spot_executor_future);
    let gateway_signer_future = async {
        match gateway_signer_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "gateway signer exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(gateway_signer_future);
    let arcade_settler_future = async {
        match arcade_settler_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "arcade settler exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(arcade_settler_future);
    let grpc_future = async {
        match grpc_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "gRPC server exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(grpc_future);
    let http_future = async {
        match http_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "HTTP /health server exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(http_future);
    let realtime_future = async {
        match realtime_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "realtime publisher exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(realtime_future);
    let ws_future = async {
        match ws_handle {
            Some(h) => {
                let res = h.await;
                error!(result = ?res, "WS gateway exited unexpectedly");
            }
            None => {
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::pin!(ws_future);
    let tick_future = async {
        match tick_handle {
            Some(h) => { let res = h.await; error!(result = ?res, "tick loop exited unexpectedly"); }
            None => { std::future::pending::<()>().await; }
        }
    };
    tokio::pin!(tick_future);
    let sweeper_future = async {
        match sweeper_handle {
            Some(h) => { let res = h.await; error!(result = ?res, "expiry sweeper exited unexpectedly"); }
            None => { std::future::pending::<()>().await; }
        }
    };
    tokio::pin!(sweeper_future);
    let wal_future = async {
        match wal_handle {
            Some(h) => { let res = h.await; error!(result = ?res, "book WAL exited unexpectedly"); }
            None => { std::future::pending::<()>().await; }
        }
    };
    tokio::pin!(wal_future);
    tokio::select! {
        _ = shutdown_signal() => {
            info!("shutdown signal received");
        }
        _ = &mut tick_future => {}
        _ = &mut sweeper_future => {}
        _ = &mut wal_future => {}
        res = subscriber_handle => {
            error!(result = ?res, "event subscriber exited unexpectedly");
        }
        res = if_handle => {
            error!(result = ?res, "insurance fund watchdog exited unexpectedly");
        }
        res = funding_handle => {
            error!(result = ?res, "funding poker exited unexpectedly");
        }
        _ = &mut canary_future => {}
        _ = &mut pyth_future => {}
        _ = &mut liquidator_future => {}
        _ = &mut telarana_liquidator_future => {}
        _ = &mut spot_executor_future => {}
        _ = &mut gateway_signer_future => {}
        _ = &mut arcade_settler_future => {}
        _ = &mut grpc_future => {}
        _ = &mut http_future => {}
        _ = &mut realtime_future => {}
        _ = &mut ws_future => {}
        res = sequencer_handle => {
            error!(result = ?res, "sequencer exited unexpectedly");
        }
        res = flusher_handle => {
            error!(result = ?res, "batch flusher exited unexpectedly");
        }
    }
    info!("BUFI matcher server stopped");
    ExitCode::SUCCESS
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(
            "bufi_matcher=info,bufi_perps_db=info,bufi_perps_onchain=info,info",
        )
    });
    tracing_subscriber::fmt().with_env_filter(filter).json().init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}
