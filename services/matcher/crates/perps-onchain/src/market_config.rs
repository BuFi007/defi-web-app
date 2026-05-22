//! Loader for `fx-telarana/deployments/perps-config-{chainId}.json`.
//!
//! The file is a flat map where market params are prefixed with the symbol
//! (e.g. `EURC_USDC_marketId`, `EURC_USDC_maxOpenInterestUsd`,
//! `EURC_USDC_initialMarginBps`, …). This loader walks the keys, groups by
//! prefix, and produces a `BTreeMap<String, MarketConfig>` keyed by symbol
//! (`EURC_USDC`, `CIRBTC_USDC`, `TCHFC_USDC`).
//!
//! The per-market `marketId` here is the `bytes32` the matcher gates on and
//! the keeper passes to `settleMatch`. NOT the Morpho lending market id —
//! that's a different surface entirely.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use alloy_primitives::{B256, U256};
use thiserror::Error;

use crate::env::fx_telarana_deployments_dir;

/// Per-market parameters. Field names match the JSON suffixes verbatim so
/// readers can cross-reference fx-telarana's deployment file by eye.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarketConfig {
    /// Symbol prefix (e.g. `"EURC_USDC"`).
    pub symbol: String,
    /// bytes32 market id — keyed in `FxPerpClearinghouse._marketConfig`.
    pub market_id: B256,
    /// Base token address (the perp's underlying — string-encoded address).
    pub base_token: String,
    /// `maxOpenInterestUsd` in 6-dec USDC. Hard ceiling the contract enforces.
    pub max_open_interest_usd: U256,
    /// `maxSkewUsd` in 6-dec USDC. Long-vs-short imbalance ceiling.
    pub max_skew_usd: U256,
    /// `initialMarginBps`. Basis points (10_000 = 100%).
    pub initial_margin_bps: u32,
    /// `maintenanceMarginBps`. Lower than initial; liquidations below this.
    pub maintenance_margin_bps: u32,
    /// `tradingFeeBps`.
    pub trading_fee_bps: u32,
    /// `maxLeverageBps` (200_000 = 20x).
    pub max_leverage_bps: u32,
    /// Whether the market is currently enabled.
    pub enabled: bool,
}

/// All markets for one chain, indexed by symbol.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MarketConfigSet {
    /// Symbol → config.
    pub markets: BTreeMap<String, MarketConfig>,
}

impl MarketConfigSet {
    /// Lookup by `bytes32` market id (linear, fine for ~10 markets).
    pub fn by_market_id(&self, id: &B256) -> Option<&MarketConfig> {
        self.markets.values().find(|m| &m.market_id == id)
    }
}

/// Errors raised by the market-config loader.
#[derive(Debug, Error)]
pub enum MarketConfigLoadError {
    /// Couldn't open or read the JSON file.
    #[error("failed to read {path}: {source}")]
    Io {
        /// Path we tried.
        path: PathBuf,
        /// Underlying io::Error.
        source: std::io::Error,
    },
    /// JSON parsing failed.
    #[error("failed to parse {path}: {source}")]
    Parse {
        /// Path we tried.
        path: PathBuf,
        /// serde_json error.
        source: serde_json::Error,
    },
    /// A required field for a market was missing.
    #[error("market `{symbol}` missing field `{field}`")]
    MissingField {
        /// Symbol prefix.
        symbol: String,
        /// Which suffix was missing.
        field: String,
    },
    /// A field couldn't be coerced to its target type.
    #[error("market `{symbol}` field `{field}` had invalid value: {reason}")]
    InvalidField {
        /// Symbol prefix.
        symbol: String,
        /// Which suffix.
        field: String,
        /// Why it didn't parse.
        reason: String,
    },
}

impl MarketConfigSet {
    /// Load `perps-config-{chain_id}.json` from `dir`.
    pub fn load_from_dir(dir: &Path, chain_id: u64) -> Result<Self, MarketConfigLoadError> {
        let path = dir.join(format!("perps-config-{chain_id}.json"));
        Self::load_from_file(&path)
    }

    /// Load from an explicit path.
    pub fn load_from_file(path: &Path) -> Result<Self, MarketConfigLoadError> {
        let raw = fs::read_to_string(path).map_err(|source| MarketConfigLoadError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let map: BTreeMap<String, serde_json::Value> =
            serde_json::from_str(&raw).map_err(|source| MarketConfigLoadError::Parse {
                path: path.to_path_buf(),
                source,
            })?;
        Self::from_flat_map(map)
    }

    /// Convenience: load via `fx_telarana_deployments_dir()`.
    pub fn load_from_env(chain_id: u64) -> Result<Self, MarketConfigLoadError> {
        Self::load_from_dir(&fx_telarana_deployments_dir(), chain_id)
    }

    /// Public for tests; otherwise use the file loaders.
    pub fn from_flat_map(
        map: BTreeMap<String, serde_json::Value>,
    ) -> Result<Self, MarketConfigLoadError> {
        // Group keys by symbol — symbol is the substring before "_marketId"
        // (or whichever suffix appears first per pair).
        let mut symbols: BTreeMap<String, BTreeMap<String, serde_json::Value>> = BTreeMap::new();
        for (k, v) in &map {
            let Some(sym) = symbol_for(k) else { continue };
            let suffix = k
                .strip_prefix(&format!("{sym}_"))
                .expect("symbol_for guarantees prefix")
                .to_string();
            symbols.entry(sym).or_default().insert(suffix, v.clone());
        }

        let mut markets = BTreeMap::new();
        for (symbol, fields) in symbols {
            let cfg = build_market(&symbol, &fields)?;
            markets.insert(symbol, cfg);
        }
        Ok(Self { markets })
    }
}

/// Identify the symbol prefix in a key like `EURC_USDC_marketId`. Symbols
/// always end at one of a small set of well-known field suffixes.
fn symbol_for(key: &str) -> Option<String> {
    for suffix in [
        "_marketId",
        "_baseToken",
        "_enabled",
        "_fundingEnabled",
        "_fundingVelocityBps",
        "_initialMarginBps",
        "_maintenanceMarginBps",
        "_maxFundingRateBpsPerSecond",
        "_maxLeverageBps",
        "_maxOpenInterestUsd",
        "_maxSkewUsd",
        "_openInterestLong",
        "_openInterestShort",
        "_tradingFeeBps",
    ] {
        if let Some(prefix) = key.strip_suffix(suffix) {
            return Some(prefix.to_string());
        }
    }
    None
}

fn build_market(
    symbol: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<MarketConfig, MarketConfigLoadError> {
    let market_id = b256_field(symbol, "marketId", fields)?;
    let base_token = string_field(symbol, "baseToken", fields)?;
    let max_open_interest_usd = u256_field(symbol, "maxOpenInterestUsd", fields)?;
    let max_skew_usd = u256_field(symbol, "maxSkewUsd", fields)?;
    let initial_margin_bps = u32_field(symbol, "initialMarginBps", fields)?;
    let maintenance_margin_bps = u32_field(symbol, "maintenanceMarginBps", fields)?;
    let trading_fee_bps = u32_field(symbol, "tradingFeeBps", fields)?;
    let max_leverage_bps = u32_field(symbol, "maxLeverageBps", fields)?;
    let enabled = bool_field(symbol, "enabled", fields)?;
    Ok(MarketConfig {
        symbol: symbol.to_string(),
        market_id,
        base_token,
        max_open_interest_usd,
        max_skew_usd,
        initial_margin_bps,
        maintenance_margin_bps,
        trading_fee_bps,
        max_leverage_bps,
        enabled,
    })
}

fn get_field<'a>(
    symbol: &str,
    field: &str,
    fields: &'a BTreeMap<String, serde_json::Value>,
) -> Result<&'a serde_json::Value, MarketConfigLoadError> {
    fields
        .get(field)
        .ok_or_else(|| MarketConfigLoadError::MissingField {
            symbol: symbol.to_string(),
            field: field.to_string(),
        })
}

fn string_field(
    symbol: &str,
    field: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<String, MarketConfigLoadError> {
    let v = get_field(symbol, field, fields)?;
    v.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| MarketConfigLoadError::InvalidField {
            symbol: symbol.to_string(),
            field: field.to_string(),
            reason: "expected string".into(),
        })
}

fn b256_field(
    symbol: &str,
    field: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<B256, MarketConfigLoadError> {
    let s = string_field(symbol, field, fields)?;
    s.parse::<B256>()
        .map_err(|e| MarketConfigLoadError::InvalidField {
            symbol: symbol.to_string(),
            field: field.to_string(),
            reason: e.to_string(),
        })
}

fn u256_field(
    symbol: &str,
    field: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<U256, MarketConfigLoadError> {
    let v = get_field(symbol, field, fields)?;
    if let Some(n) = v.as_u64() {
        return Ok(U256::from(n));
    }
    if let Some(s) = v.as_str() {
        return s.parse::<U256>().map_err(|e| MarketConfigLoadError::InvalidField {
            symbol: symbol.to_string(),
            field: field.to_string(),
            reason: e.to_string(),
        });
    }
    Err(MarketConfigLoadError::InvalidField {
        symbol: symbol.to_string(),
        field: field.to_string(),
        reason: "expected u64 or decimal string".into(),
    })
}

fn u32_field(
    symbol: &str,
    field: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<u32, MarketConfigLoadError> {
    let v = get_field(symbol, field, fields)?;
    v.as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| MarketConfigLoadError::InvalidField {
            symbol: symbol.to_string(),
            field: field.to_string(),
            reason: "expected u32".into(),
        })
}

fn bool_field(
    symbol: &str,
    field: &str,
    fields: &BTreeMap<String, serde_json::Value>,
) -> Result<bool, MarketConfigLoadError> {
    let v = get_field(symbol, field, fields)?;
    v.as_bool().ok_or_else(|| MarketConfigLoadError::InvalidField {
        symbol: symbol.to_string(),
        field: field.to_string(),
        reason: "expected bool".into(),
    })
}
