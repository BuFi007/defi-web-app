//! Phase 5 funding poker.
//!
//! Replaces `apps/keeper-perps-funding` (TS) in the same way the Phase 3c
//! tick loop replaced `apps/keeper-perps-matcher`. Per-market throttle is
//! 1h by default, matching the contract's funding interval and the TS
//! keeper's behaviour. Restart-safe: the throttle map is reseeded from
//! `FxFundingEngine.fundingState(market_id).lastUpdate` on boot, so the
//! poker won't double-poke right after a process restart.
//!
//! Mark-price safety (Phase 5 doc): the matcher's matching + LP-gate
//! reads use the lenient `_priceView` path correctly. The verified path
//! (`_priceViewVerified` / `unrealizedPnlVerified`) is reserved for
//! liquidation, which is its own keeper. No matcher action needed for
//! mark-price safety in Phase 5 — Phase 4's oracle-freshness gate already
//! covers the matcher-side risk surface.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_primitives::B256;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use bufi_perps_onchain::PerpsOnchain;

use crate::config::Config;

/// One funding poker — owns its in-memory throttle map.
pub struct FundingPoker {
    onchain: PerpsOnchain,
    market_ids: Vec<[u8; 32]>,
    poll_interval: Duration,
    min_interval: Duration,
    /// `market_id_hex -> unix_secs_of_last_poke`. Survives ticks, lost on restart;
    /// the boot reseed handles that case.
    last_poke_at_secs: HashMap<String, u64>,
}

impl FundingPoker {
    /// Build from config. Does NOT seed the throttle map — call `seed_from_chain`
    /// once at boot so we don't double-poke if the process restarted recently.
    pub fn new(onchain: PerpsOnchain, config: &Config) -> Self {
        Self {
            onchain,
            market_ids: config.funding_market_ids.clone(),
            poll_interval: config.funding_poll,
            min_interval: config.funding_poke_min_interval,
            last_poke_at_secs: HashMap::new(),
        }
    }

    /// Read `fundingState.lastUpdate` for every configured market and
    /// initialise the throttle map. Boot-time only.
    pub async fn seed_from_chain(&mut self) {
        for id in &self.market_ids {
            let b = B256::from(*id);
            match self.onchain.funding_last_update_secs(b).await {
                Ok(secs) => {
                    self.last_poke_at_secs.insert(hex32(id), secs);
                    debug!(market = ?b, last_update_secs = secs, "funding: seeded throttle");
                }
                Err(e) => {
                    warn!(market = ?b, error = ?e, "funding: seed failed");
                }
            }
        }
    }

    /// Run forever until the parent task cancels us.
    pub async fn run(mut self) {
        if self.market_ids.is_empty() {
            warn!("funding poker: no markets configured (MATCHER_FUNDING_MARKET_IDS); idling");
            return;
        }
        self.seed_from_chain().await;
        info!(
            markets = self.market_ids.len(),
            poll_ms = self.poll_interval.as_millis() as u64,
            min_interval_ms = self.min_interval.as_millis() as u64,
            "funding poker started"
        );
        loop {
            if let Err(e) = self.tick().await {
                warn!(error = ?e, "funding poker tick failed; backing off");
            }
            sleep(self.poll_interval).await;
        }
    }

    async fn tick(&mut self) -> Result<TickReport, anyhow_lite::Error> {
        let now = current_unix_secs();
        let min_secs = self.min_interval.as_secs();
        let mut poked = Vec::new();
        let mut throttled = Vec::new();
        let mut failed = Vec::new();
        for id in self.market_ids.clone() {
            let key = hex32(&id);
            let last = self.last_poke_at_secs.get(&key).copied().unwrap_or(0);
            if last + min_secs > now {
                throttled.push(key);
                continue;
            }
            match self.onchain.submit_poke_funding(B256::from(id)).await {
                Ok(tx) => {
                    self.last_poke_at_secs.insert(key.clone(), now);
                    poked.push((key, format!("{tx:#x}")));
                }
                Err(e) => {
                    let msg = e.to_string();
                    // Underpriced / already-known races are soft — bump the
                    // throttle so we don't retry until the interval passes.
                    if is_race_error(&msg) {
                        self.last_poke_at_secs.insert(key.clone(), now);
                        throttled.push(key);
                    } else {
                        failed.push((key, msg));
                    }
                }
            }
        }
        if poked.is_empty() && failed.is_empty() {
            debug!(
                markets = self.market_ids.len(),
                throttled = throttled.len(),
                "funding poker tick: all markets throttled"
            );
        } else {
            info!(
                markets = self.market_ids.len(),
                ?poked,
                throttled = throttled.len(),
                ?failed,
                "funding poker tick"
            );
        }
        Ok(TickReport {
            poked: poked.len(),
            throttled: throttled.len(),
            failed: failed.len(),
        })
    }
}

/// Tick metrics. Returned for the unit test; the real binary reads it
/// out of the tracing output.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct TickReport {
    pub poked: usize,
    pub throttled: usize,
    pub failed: usize,
}

fn hex32(id: &[u8; 32]) -> String {
    let mut out = String::with_capacity(2 + 64);
    out.push_str("0x");
    for b in id {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn is_race_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("underpriced") || lower.contains("already known") || lower.contains("nonce too low")
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Tiny inline error wrapper — funding poker only ever surfaces transport
/// errors and they're all logged + retried. Avoids a real error type.
mod anyhow_lite {
    #[derive(Debug)]
    pub struct Error(pub String);
    impl std::fmt::Display for Error {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.0)
        }
    }
    impl std::error::Error for Error {}
    impl From<String> for Error {
        fn from(s: String) -> Self {
            Error(s)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn race_error_classifier_catches_known_phrases() {
        assert!(is_race_error("transaction underpriced"));
        assert!(is_race_error("already known"));
        assert!(is_race_error("nonce too low"));
        assert!(is_race_error("ALREADY KNOWN"));
        assert!(!is_race_error("market disabled"));
        assert!(!is_race_error("revert: insufficient gas"));
    }

    #[test]
    fn hex32_lowercases_with_0x_prefix() {
        let id = [0xAB; 32];
        assert_eq!(hex32(&id), format!("0x{}", "ab".repeat(32)));
    }
}
