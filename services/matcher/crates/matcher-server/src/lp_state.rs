//! Path A `LpStateView` impl bridging `bufi_perps_db::LpPosition` →
//! `bufi_orderbook::LpSnapshot`.
//!
//! Per the Phase 4a design lock (`docs/lp-backstop-design.md` §Locked
//! decisions), Path A reads LP state from the matcher's local SQLite
//! `lp_positions` table. Path B will swap this impl for one that reads
//! `FxPerpLpVault.position(market_id)` directly; the orderbook crate's
//! `LpStateView` trait stays unchanged.
//!
//! Per-market `LpConfig` lives in a tiny `BTreeMap` keyed by market id,
//! loaded once at boot from the market-config JSON. Phase 5 can promote
//! it to a hot-reloaded structure if operators need to tune caps live.

use std::collections::BTreeMap;

use bufi_orderbook::{LpConfig, LpSnapshot, LpStateView, MarketId};
use bufi_perps_db::PerpsDb;
use tracing::warn;

/// Path A view — reads `lp_positions` rows from the matcher's SQLite.
pub struct PathALpStateView {
    db: PerpsDb,
    /// Per-market overrides; missing markets get `LpConfig::default()`.
    configs: BTreeMap<MarketId, LpConfig>,
}

impl PathALpStateView {
    /// Build with the default `LpConfig` for every market. Per-market
    /// overrides can be inserted via `with_config` before the router
    /// starts.
    pub fn new(db: PerpsDb) -> Self {
        Self {
            db,
            configs: BTreeMap::new(),
        }
    }

    /// Builder helper for tests + boot-time overrides. Hot-reload is a
    /// Phase 5 concern; today the configs are static after boot.
    #[allow(dead_code)]
    pub fn with_config(mut self, market_id: MarketId, cfg: LpConfig) -> Self {
        self.configs.insert(market_id, cfg);
        self
    }
}

impl LpStateView for PathALpStateView {
    async fn snapshot(&self, market_id: MarketId) -> Option<LpSnapshot> {
        let market_id_hex = market_id_hex(&market_id);
        match self.db.get_lp_position(&market_id_hex).await {
            Ok(Some(row)) => {
                let tvl = row.tvl_usdc_e6.parse::<u128>().unwrap_or(0);
                let long = row.long_e18.parse::<u128>().unwrap_or(0);
                let short = row.short_e18.parse::<u128>().unwrap_or(0);
                let avg = row.avg_intent_size_e18.parse::<u128>().unwrap_or(0);
                Some(LpSnapshot {
                    market_id,
                    tvl_usdc_e6: tvl,
                    long_e18: long,
                    short_e18: short,
                    avg_intent_size_e18: avg,
                    enabled: row.enabled,
                })
            }
            Ok(None) => None,
            Err(e) => {
                warn!(market = market_id_hex, error = ?e, "lp_state: read failed");
                None
            }
        }
    }

    fn config(&self, market_id: MarketId) -> LpConfig {
        self.configs
            .get(&market_id)
            .copied()
            .unwrap_or_default()
    }
}

/// Encode a 32-byte market id as the lowercase 0x-prefixed hex string
/// the DB column stores.
pub fn market_id_hex(market_id: &MarketId) -> String {
    let mut out = String::with_capacity(2 + 64);
    out.push_str("0x");
    for b in market_id {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
