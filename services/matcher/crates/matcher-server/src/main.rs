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
use tracing::{error, info};

use bufi_perps_db::PerpsDb;
use bufi_perps_onchain::{PerpsDeployment, PerpsOnchain};

use crate::funding_poker::FundingPoker;
use crate::insurance_fund::InsuranceFundWatchdog;
use crate::lp_signer::LpSigner;
use crate::lp_state::PathALpStateView;

mod canary;
mod config;
mod event_subscriber;
mod funding_poker;
mod grpc;
mod http_health;
mod insurance_fund;
mod intent_translator;
mod lp_router;
mod lp_signer;
mod lp_state;
mod oi_gate;
mod price;
mod pyth_pusher;
mod replacement_events;
mod settlement;
mod tick;

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

    // ---------- Pyth pusher (Phase 7.2 — unblocks LP oracle gate) ----------
    let pyth_handle = match pyth_pusher::PythPusher::new(onchain.clone(), &cfg) {
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

    // ---------- Tick loop ----------
    let tick_cfg = cfg.clone();
    let tick_db = db.clone();
    let tick_onchain = onchain.clone();
    let tick_deployment = deployment;
    let tick_grpc_state = grpc_handle.as_ref().map(|_| grpc_state.clone());
    let tick_handle = tokio::spawn(async move {
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
    });

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
    tokio::select! {
        _ = shutdown_signal() => {
            info!("shutdown signal received");
        }
        res = tick_handle => {
            error!(result = ?res, "tick loop exited unexpectedly");
        }
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
        _ = &mut grpc_future => {}
        _ = &mut http_future => {}
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
