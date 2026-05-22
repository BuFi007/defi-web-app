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

use bufi_perps_onchain::env::{ARC_CHAIN_ID, DEFAULT_ARC_RPC_URL};

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
    /// JSON-RPC endpoint for that chain.
    pub rpc_url: String,
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
}

impl Config {
    /// Load every env var, applying the documented defaults.
    pub fn from_env() -> Result<Self, ConfigError> {
        let chain_id = parse_env_u64("MATCHER_CHAIN_ID", ARC_CHAIN_ID)?;
        let rpc_url =
            env::var("ARC_RPC_URL").unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string());
        let signer_key_hex = env::var("PERP_KEEPER_PRIVATE_KEY")
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
        Ok(Self {
            chain_id,
            rpc_url,
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
        })
    }

    /// Returns the signer key or a typed error — used at the boot site to
    /// fail fast when the keeper signer is missing.
    pub fn require_signer(&self) -> Result<&str, ConfigError> {
        self.signer_key_hex
            .as_deref()
            .ok_or(ConfigError::InvalidNumber {
                name: "PERP_KEEPER_PRIVATE_KEY",
                reason: "no signer set (PERP_KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY)".into(),
            })
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
