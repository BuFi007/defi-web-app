//! Runtime configuration loaded from environment variables.
//!
//! Defaults are tuned for the Arc Testnet keeper role and mirror what
//! `apps/keeper-perps-matcher` (TS) expected before this Rust binary
//! replaces it. Env-var names align with `fx-telarana/packages/sdk/src/
//! perps-keeper.ts` so the same `.env.local` keeps working.

use std::env;
use std::path::PathBuf;
use std::time::Duration;

use thiserror::Error;

use bufi_perps_onchain::env::{ARC_CHAIN_ID, DEFAULT_ARC_RPC_FALLBACK_URL, DEFAULT_ARC_RPC_URL};

/// Default cursor file location for the event subscriber.
const DEFAULT_EVENT_CURSOR_PATH: &str = ".bufi/matcher-event-cursor.json";

/// Errors raised when env config is invalid.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// An env var that needed a numeric value couldn't be parsed.
    #[error("env {name}: {reason}")]
    InvalidNumber {
        /// Env var name.
        name: &'static str,
        /// Why parsing failed.
        reason: String,
    },
}

/// Parsed runtime configuration. Built once at boot via [`Config::from_env`].
#[derive(Debug, Clone)]
pub struct Config {
    /// Target chain id (default Arc Testnet, 5_042_002).
    pub chain_id: u64,
    /// JSON-RPC endpoint for that chain (primary). Defaults to dRPC
    /// (`rpc.drpc.testnet.arc.network`), ~2x faster than the public endpoint.
    /// Override via `ARC_RPC_URL`.
    pub rpc_url: String,
    /// JSON-RPC fallback endpoint. Defaults to the public Circle endpoint
    /// (`rpc.testnet.arc.network`). Override via `ARC_RPC_FALLBACK_URL`.
    /// Currently surfaced for callers that want explicit failover; the
    /// matcher's alloy provider is built against `rpc_url` only — wire
    /// a fallback transport once alloy's stable surface lands.
    #[allow(dead_code)]
    pub rpc_fallback_url: String,
    /// Keeper signing key (`PERP_KEEPER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY`).
    /// `None` causes the boot sequence to error in `Config::require_signer`.
    pub signer_key_hex: Option<String>,
    /// LP_OPERATOR signing key (`LP_OPERATOR_PRIVATE_KEY`). MUST differ from
    /// the keeper key — the on-chain `settleMatch` rejects `maker == taker`.
    /// `None` disables LP routing (matcher works as a pure CLOB).
    pub lp_operator_key_hex: Option<String>,
    /// Path to the bun:sqlite trading-machine DB.
    pub db_path: PathBuf,
    /// Path to `fx-telarana/deployments/` (env `FX_TELARANA_DEPLOYMENTS`).
    pub fx_telarana_deployments_dir: Option<PathBuf>,
    /// Tick interval when the previous tick produced work.
    pub tick_busy: Duration,
    /// Tick interval when the previous N ticks were idle.
    pub tick_idle: Duration,
    /// How many idle ticks before pacing relaxes from busy → idle interval.
    pub idle_ticks_to_relax: u32,
    /// Event subscriber poll cadence.
    pub event_poll: Duration,
    /// Number of confirmations to wait before treating a block as final.
    pub event_confirmations: u64,
    /// File the event subscriber writes its block cursor to.
    pub event_cursor_path: PathBuf,
    /// Funding-poker tick cadence. The TS keeper ticked every 5s; we keep
    /// the same default. Pure-loop interval, not the per-market throttle.
    pub funding_poll: Duration,
    /// Minimum interval between consecutive `pokeFundingRate` calls for the
    /// SAME market. Defaults to 1h to match the on-chain funding interval.
    /// Per-market state is in-memory; restarts re-derive from the contract's
    /// `fundingState.lastUpdate` view.
    pub funding_poke_min_interval: Duration,
    /// Comma-separated list of bytes32 market ids the funding poker should
    /// keep awake. Defaults to the three sprint-1 Arc markets — see
    /// `docs/lp-backstop-design.md` §Locked decisions for the source list.
    pub funding_market_ids: Vec<[u8; 32]>,
    /// Canary trader signing key (`CANARY_TRADER_PRIVATE_KEY`). Phase 7 —
    /// third EOA, distinct from the keeper and the LP_OPERATOR. Optional;
    /// `None` disables the canary loop. MUST be funded with margin on the
    /// canary market for the synthetic intent to settle.
    pub canary_trader_key_hex: Option<String>,
    /// How often the canary inserts + observes one synthetic intent.
    /// Defaults to 30 minutes per the Phase 7 spec amendment; bump down for
    /// staging or up for cost-sensitive prod.
    pub canary_interval: Duration,
    /// Per-attempt timeout: if the canary intent doesn't reach a terminal
    /// status (`filled`, `rejected`, `expired`) within this window, the
    /// canary emits an `ERROR` log. Defaults to 2 minutes.
    pub canary_timeout: Duration,
    /// Bytes32 market id the canary trades on. Defaults to the sprint-1
    /// EURC/USDC perp on Arc — the most liquid market with a known LP
    /// quote available for the matcher to bounce off.
    pub canary_market_id: [u8; 32],
    /// Synthetic intent notional in USDC quantums (6-dec). Defaults to
    /// 1_000_000 (= 1 USDC). The canary is intentionally tiny so a single
    /// bad day doesn't burn the canary's margin.
    pub canary_notional_usdc_e6: u64,
    /// How often the pyth_pusher polls Hermes + pushes on-chain. Default
    /// 5_000ms (5s) — matches the funding_poker cadence. Tighter means
    /// fresher oracle, more gas burn. Phase 7.2.
    pub pyth_push_interval: Duration,
    /// Skip the push if the on-chain `publishTime + this > now`. Default
    /// 30s. This keeps gas burn near-zero in quiet markets while still
    /// guaranteeing the LP-backstop oracle gate (also 30s) never trips.
    pub pyth_push_max_age: Duration,
    /// Hermes endpoint base URL. Default `https://hermes.pyth.network`.
    /// Pin to a private mirror for production reliability.
    pub pyth_hermes_url: String,
    /// HTTP timeout for Hermes fetches. Default 10s.
    pub pyth_hermes_timeout: Duration,
    /// Phase 8.5c — use the Hermes WebSocket subscription instead of
    /// the legacy HTTP poll. Default `true`. Production can opt out
    /// via `MATCHER_PYTH_USE_WS=false` if Hermes WS misbehaves; the
    /// HTTP poll loop is retained as the fall-back path inside
    /// `pyth_pusher` itself (kicks in automatically after 3 failed
    /// WS connection attempts).
    pub pyth_use_ws: bool,
    /// Phase 8.5c — explicit override for the Hermes WS URL. Default
    /// is derived from `pyth_hermes_url` by swapping `https→wss` and
    /// appending `/ws`. Set when the mirror serves WS on a different
    /// host than the REST endpoint.
    pub pyth_hermes_ws_url: Option<String>,
    /// Enable the Rust perps liquidator. Defaults off so local dev does not
    /// send liquidation txs unless the operator opts in.
    pub liquidator_enabled: bool,
    /// Envio GraphQL endpoint used as the canonical open-position set.
    pub liquidator_envio_url: String,
    /// Fallback scan cadence when Pyth WS is quiet or unavailable.
    pub liquidator_check_interval: Duration,
    /// Max PositionChange rows to read from Envio per refresh.
    pub liquidator_page_size: usize,
    /// Max concurrent liquidation pre-checks/tx attempts.
    pub liquidator_max_concurrent_checks: usize,
    /// Optional explicit LiquidationRouter address. If absent, the matcher
    /// reads `liquidation-router-{chainId}.json` from the deployments dir.
    pub liquidation_router_address: Option<String>,
    /// Enable the Rust Telarana money-market liquidator. Defaults to FALSE
    /// (safe-default): production deployments must set
    /// `TELARANA_LIQUIDATOR_ENABLED=true` to opt in to tx broadcasting.
    pub telarana_liquidator_enabled: bool,
    /// BUFI API base URL used for Telarana liquidation candidates.
    pub telarana_api_url: String,
    /// Hub chain ids scanned by the Telarana liquidator.
    pub telarana_liquidator_chain_ids: Vec<u64>,
    /// Telarana candidate scan cadence.
    pub telarana_liquidator_interval: Duration,
    /// If true, log liquidatable candidates but do not submit txs.
    pub telarana_liquidator_dry_run: bool,
    /// Max Telarana liquidation candidates requested per hub scan.
    pub telarana_liquidator_candidate_limit: usize,
    /// Enable the Rust spot executor role. Defaults to FALSE (safe-default):
    /// production deployments must set `SPOT_EXECUTOR_ENABLED=true` to opt in.
    pub spot_executor_enabled: bool,
    /// Enable the Rust gateway signer role. Defaults to FALSE (safe-default):
    /// production deployments must set `GATEWAY_SIGNER_ENABLED=true` to opt in.
    pub gateway_signer_enabled: bool,
    /// Enable the Rust arcade settler role. Defaults to FALSE (safe-default):
    /// production deployments must set `ARCADE_SETTLER_ENABLED=true` to opt in.
    pub arcade_settler_enabled: bool,
    /// gRPC server bind address. Default `127.0.0.1:3005` (loopback —
    /// container or multi-host deployments override to `0.0.0.0:<port>`).
    /// Set to empty string via `MATCHER_GRPC_BIND=` to disable the
    /// server entirely. Phase 8.
    pub grpc_bind: String,
    /// HTTP /health + /ready + /metrics bind address. Default
    /// `127.0.0.1:3006` (loopback). Separate port from gRPC so k8s
    /// liveness probes + Prometheus scrapes use vanilla HTTP/1.1
    /// without negotiating HTTP/2 prior-knowledge. Set to empty
    /// string via `MATCHER_HTTP_BIND=` to disable. Phase 8.5a.
    pub http_bind: String,
    /// /ready threshold — return 503 if no tick has bumped
    /// `last_tick_ms` within this window. Default 2 × tick_idle.
    /// Phase 8.5a.
    pub ready_max_tick_age: Duration,
    /// Optional Redis URL for the realtime publisher. Empty = disabled
    /// (the default). Set to e.g. `redis://127.0.0.1:6379/` to fan
    /// out trades + book updates to Redis pub/sub channels in
    /// addition to the existing gRPC `StreamTrades` / `StreamBook`
    /// broadcasts. Phase 8.5b — replaces apps/keeper-perps-matcher
    /// Redis publisher (TS-side PR #74).
    pub redis_url: String,
    /// Channel prefix for Redis publishes. Default `bufi:`. Final
    /// channels: `<prefix>trades:<market_id_hex>` (per-market),
    /// `<prefix>trades` (firehose across all markets),
    /// `<prefix>book:<market_id_hex>` (per-market book). Phase 8.5b.
    pub redis_channel_prefix: String,
    /// WebSocket gateway bind address for the Hybrid CLOB sequencer.
    /// Default empty (disabled). Set `MATCHER_WS_BIND=127.0.0.1:3007`
    /// to enable. Phase 2.
    pub ws_bind: String,
    /// Batch flusher interval in ms. Default 3000 (3s). Phase 2.
    pub batch_interval_ms: u64,
    /// Max fills before forced flush. Default 20. Phase 2.
    pub batch_max_fills: usize,
}

impl Config {
    /// Load every env var, applying the documented defaults.
    pub fn from_env() -> Result<Self, ConfigError> {
        let chain_id = parse_env_u64("MATCHER_CHAIN_ID", ARC_CHAIN_ID)?;
        let rpc_url =
            env::var("ARC_RPC_URL").unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string());
        let rpc_fallback_url = env::var("ARC_RPC_FALLBACK_URL")
            .unwrap_or_else(|_| DEFAULT_ARC_RPC_FALLBACK_URL.to_string());
        // Resolution order matches the established defi-web-app keeper
        // conventions: PERP_KEEPER_PRIVATE_KEY (most explicit) →
        // KEEPER_PRIVATE_KEY (the name the .env.local at the monorepo root
        // already uses for the TS keepers) → DEPLOYER_PRIVATE_KEY (legacy
        // fallback). The matcher signs settleMatch + funding poke + Pyth
        // push txs from this EOA.
        let signer_key_hex = env::var("PERP_KEEPER_PRIVATE_KEY")
            .or_else(|_| env::var("KEEPER_PRIVATE_KEY"))
            .or_else(|_| env::var("DEPLOYER_PRIVATE_KEY"))
            .ok()
            .map(|s| s.trim_start_matches("0x").to_string());
        let lp_operator_key_hex = env::var("LP_OPERATOR_PRIVATE_KEY")
            .ok()
            .map(|s| s.trim_start_matches("0x").to_string());
        let db_path = env::var("BUFI_DB_PATH")
            .or_else(|_| env::var("TRADING_MACHINE_DB_PATH"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(".bufi/trading-machine.sqlite"));
        let fx_telarana_deployments_dir =
            env::var_os("FX_TELARANA_DEPLOYMENTS").map(PathBuf::from);
        let tick_busy = Duration::from_millis(parse_env_u64("MATCHER_TICK_BUSY_MS", 1_000)?);
        let tick_idle = Duration::from_millis(parse_env_u64("MATCHER_TICK_IDLE_MS", 30_000)?);
        let idle_ticks_to_relax = parse_env_u64("MATCHER_IDLE_TICKS_TO_RELAX", 5)? as u32;
        let event_poll = Duration::from_millis(parse_env_u64("MATCHER_EVENT_POLL_MS", 5_000)?);
        let event_confirmations = parse_env_u64("MATCHER_EVENT_CONFIRMATIONS", 3)?;
        let event_cursor_path = env::var("MATCHER_EVENT_CURSOR_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_EVENT_CURSOR_PATH));
        let funding_poll =
            Duration::from_millis(parse_env_u64("MATCHER_FUNDING_POLL_MS", 5_000)?);
        let funding_poke_min_interval = Duration::from_millis(parse_env_u64(
            "FUNDING_POKE_MIN_INTERVAL_MS",
            3_600_000,
        )?);
        let funding_market_ids = parse_funding_market_ids(
            env::var("MATCHER_FUNDING_MARKET_IDS").as_deref().ok(),
        );
        let canary_trader_key_hex = env::var("CANARY_TRADER_PRIVATE_KEY")
            .ok()
            .map(|s| s.trim_start_matches("0x").to_string());
        let canary_interval =
            Duration::from_secs(parse_env_u64("CANARY_INTERVAL_SECS", 1_800)?);
        let canary_timeout =
            Duration::from_secs(parse_env_u64("CANARY_TIMEOUT_SECS", 120)?);
        // Default: EURC/USDC perp (same id as the default funding market).
        let canary_market_id = env::var("CANARY_MARKET_ID")
            .ok()
            .and_then(|s| parse_b256_hex(&s))
            .unwrap_or_else(|| {
                parse_b256_hex(
                    "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
                )
                .expect("hard-coded canary market id is valid")
            });
        let canary_notional_usdc_e6 = parse_env_u64("CANARY_NOTIONAL_USDC_E6", 1_000_000)?;
        let pyth_push_interval =
            Duration::from_millis(parse_env_u64("PYTH_PUSH_INTERVAL_MS", 5_000)?);
        let pyth_push_max_age =
            Duration::from_secs(parse_env_u64("PYTH_PUSH_MAX_AGE_SECS", 30)?);
        let pyth_hermes_url = env::var("PYTH_HERMES_URL")
            .unwrap_or_else(|_| "https://hermes.pyth.network".to_string());
        let pyth_hermes_timeout =
            Duration::from_millis(parse_env_u64("PYTH_HERMES_TIMEOUT_MS", 10_000)?);
        // Phase 8.5c — WS path is the new default. Two ways to opt
        // out: MATCHER_PYTH_USE_WS=false (preserves legacy env name)
        // or PYTH_USE_WS=false (shorter; checked second).
        let pyth_use_ws = env::var("MATCHER_PYTH_USE_WS")
            .or_else(|_| env::var("PYTH_USE_WS"))
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off" | ""))
            .unwrap_or(true);
        let pyth_hermes_ws_url = env::var("PYTH_HERMES_WS_URL").ok();
        let liquidator_enabled = parse_env_bool("LIQUIDATOR_ENABLED", false);
        let liquidator_envio_url = env::var("LIQUIDATOR_ENVIO_URL")
            .or_else(|_| env::var("ENVIO_GRAPHQL_URL"))
            .or_else(|_| env::var("ENVIO_URL"))
            .unwrap_or_else(|_| "https://indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql".to_string());
        let liquidator_check_interval =
            Duration::from_millis(parse_env_u64("LIQUIDATOR_CHECK_INTERVAL_MS", 1_000)?);
        let liquidator_page_size = parse_env_u64("LIQUIDATOR_PAGE_SIZE", 1_000)? as usize;
        let liquidator_max_concurrent_checks =
            parse_env_u64("LIQUIDATOR_MAX_CONCURRENT_CHECKS", 8)? as usize;
        let liquidation_router_address = env::var("LIQUIDATION_ROUTER_ADDRESS")
            .or_else(|_| env::var("LIQUIDATOR_ROUTER_ADDRESS"))
            .ok();
        // SAFE-DEFAULT: tx-sending keepers default to OFF so a misconfigured
        // local dev or fresh deploy cannot accidentally start broadcasting
        // liquidations / settlements / gateway mints. Production must opt
        // in explicitly by setting the corresponding env var to `true`.
        let telarana_liquidator_enabled = parse_env_bool("TELARANA_LIQUIDATOR_ENABLED", false);
        let telarana_api_url = env::var("TELARANA_API_URL")
            .or_else(|_| env::var("BUFI_API_URL"))
            .unwrap_or_else(|_| "http://localhost:3002".to_string());
        let telarana_liquidator_chain_ids = parse_chain_ids(
            env::var("TELARANA_LIQUIDATOR_CHAIN_IDS")
                .or_else(|_| env::var("TELARANA_CHAIN_IDS"))
                .as_deref()
                .ok(),
        );
        let telarana_liquidator_interval = Duration::from_millis(parse_env_u64(
            "TELARANA_LIQUIDATOR_INTERVAL_MS",
            parse_env_u64("LIQUIDATOR_INTERVAL_MS", 30_000)?,
        )?);
        let telarana_liquidator_dry_run = parse_env_bool(
            "TELARANA_LIQUIDATOR_DRY_RUN",
            parse_env_bool("LIQUIDATOR_DRY_RUN", false),
        );
        let telarana_liquidator_candidate_limit =
            parse_env_u64("TELARANA_LIQUIDATOR_CANDIDATE_LIMIT", 50)? as usize;
        // SAFE-DEFAULT: see telarana_liquidator_enabled above. All three of
        // these keepers sign + broadcast on-chain txs; default off.
        let spot_executor_enabled = parse_env_bool("SPOT_EXECUTOR_ENABLED", false);
        let gateway_signer_enabled = parse_env_bool("GATEWAY_SIGNER_ENABLED", false);
        let arcade_settler_enabled = parse_env_bool("ARCADE_SETTLER_ENABLED", false);
        let grpc_bind = env::var("MATCHER_GRPC_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3005".to_string());
        let http_bind = env::var("MATCHER_HTTP_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3006".to_string());
        // Default = 2 × tick_idle. Override via
        // MATCHER_READY_MAX_TICK_AGE_MS for tighter / looser SLAs.
        let ready_max_tick_age = Duration::from_millis(parse_env_u64(
            "MATCHER_READY_MAX_TICK_AGE_MS",
            (tick_idle.as_millis() as u64).saturating_mul(2),
        )?);
        // Phase 8.5b — empty by default. Set MATCHER_REDIS_URL=
        // explicitly to disable; set to a real URL to enable.
        let redis_url = env::var("MATCHER_REDIS_URL").unwrap_or_default();
        let redis_channel_prefix = env::var("MATCHER_REDIS_CHANNEL_PREFIX")
            .unwrap_or_else(|_| "bufi:".to_string());
        Ok(Self {
            chain_id,
            rpc_url,
            rpc_fallback_url,
            signer_key_hex,
            lp_operator_key_hex,
            db_path,
            fx_telarana_deployments_dir,
            tick_busy,
            tick_idle,
            idle_ticks_to_relax,
            event_poll,
            event_confirmations,
            event_cursor_path,
            funding_poll,
            funding_poke_min_interval,
            funding_market_ids,
            canary_trader_key_hex,
            canary_interval,
            canary_timeout,
            canary_market_id,
            canary_notional_usdc_e6,
            pyth_push_interval,
            pyth_push_max_age,
            pyth_hermes_url,
            pyth_hermes_timeout,
            pyth_use_ws,
            pyth_hermes_ws_url,
            liquidator_enabled,
            liquidator_envio_url,
            liquidator_check_interval,
            liquidator_page_size,
            liquidator_max_concurrent_checks,
            liquidation_router_address,
            telarana_liquidator_enabled,
            telarana_api_url,
            telarana_liquidator_chain_ids,
            telarana_liquidator_interval,
            telarana_liquidator_dry_run,
            telarana_liquidator_candidate_limit,
            spot_executor_enabled,
            gateway_signer_enabled,
            arcade_settler_enabled,
            grpc_bind,
            http_bind,
            ready_max_tick_age,
            redis_url,
            redis_channel_prefix,
            ws_bind: env::var("MATCHER_WS_BIND").unwrap_or_default(),
            batch_interval_ms: parse_env_u64("MATCHER_BATCH_INTERVAL_MS", 3_000)?,
            batch_max_fills: parse_env_u64("MATCHER_BATCH_MAX_FILLS", 20)? as usize,
        })
    }

    /// Returns the signer key or a typed error — used at the boot site to
    /// fail fast when the keeper signer is missing.
    pub fn require_signer(&self) -> Result<&str, ConfigError> {
        self.signer_key_hex
            .as_deref()
            .ok_or(ConfigError::InvalidNumber {
                name: "PERP_KEEPER_PRIVATE_KEY",
                reason: "no signer set (set PERP_KEEPER_PRIVATE_KEY, KEEPER_PRIVATE_KEY, or DEPLOYER_PRIVATE_KEY in .env.local)".into(),
            })
    }
}

/// Parse the env-supplied or fallback list of bytes32 market ids for the
/// funding poker. Defaults to the three Arc Testnet sprint-1 markets per
/// `fx-telarana/deployments/perps-config-5042002.json`.
fn parse_funding_market_ids(raw: Option<&str>) -> Vec<[u8; 32]> {
    // All 4 live Arc sprint-1 perp markets per
    // ~/coding-dojo/fx-telarana/deployments/perps-config-5042002.json.
    // tCHFC is registered in the SDK but `enabled=false` on-chain, so it's
    // excluded here — adding it would just produce wasted funding-poke
    // failures every tick.
    const DEFAULTS: [&str; 4] = [
        // EURC/USDC perp
        "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
        // tJPYC/USDC perp
        "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
        // tMXNB/USDC perp
        "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
        // CIRBTC/USDC perp
        "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
    ];
    let source: Vec<&str> = match raw {
        Some(s) => s.split(',').map(|p| p.trim()).filter(|p| !p.is_empty()).collect(),
        None => DEFAULTS.to_vec(),
    };
    let mut out = Vec::with_capacity(source.len());
    for s in source {
        if let Some(b) = parse_b256_hex(s) {
            out.push(b);
        }
    }
    out
}

fn parse_chain_ids(raw: Option<&str>) -> Vec<u64> {
    let source: Vec<&str> = match raw {
        Some(s) => s.split(',').map(|p| p.trim()).filter(|p| !p.is_empty()).collect(),
        None => vec!["43113", "5042002"],
    };
    source.into_iter().filter_map(|s| s.parse::<u64>().ok()).collect()
}

fn parse_b256_hex(s: &str) -> Option<[u8; 32]> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    if stripped.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(chunk).ok()?;
        out[i] = u8::from_str_radix(hex, 16).ok()?;
    }
    Some(out)
}

fn parse_env_bool(name: &'static str, default: bool) -> bool {
    match env::var(name) {
        Ok(raw) => matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

fn parse_env_u64(name: &'static str, default: u64) -> Result<u64, ConfigError> {
    match env::var(name) {
        Ok(s) => s.parse::<u64>().map_err(|e| ConfigError::InvalidNumber {
            name,
            reason: e.to_string(),
        }),
        Err(_) => Ok(default),
    }
}
