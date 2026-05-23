//! Insurance-fund watchdog — invariant 6.
//!
//! Phase 4 (Path A) implementation: a slow tokio task that polls the
//! `lp_realised_pnl` table every `INSURANCE_FUND_POLL_SECS` and emits a
//! tracing warning whenever any market's same-day cumulative loss crosses
//! the configured `if_burn_floor_usdc_e6` threshold.
//!
//! Path B (when `FxPerpLpVault` deploys) replaces the warning with an
//! actual `FxInsuranceFund.burnShares(loss)` call. The matcher-side
//! detection logic is identical; only the action differs.

use std::time::Duration;

use sqlx::Row;
use tokio::time::sleep;
use tracing::{debug, warn};

use bufi_perps_db::PerpsDb;

/// Phase 4 default — poll every 60s. Cheap (one SQLite query) and matches
/// the cadence at which loss events meaningfully change.
pub const INSURANCE_FUND_POLL_SECS: u64 = 60;

/// Locked default from `docs/lp-backstop-design.md` §Locked decisions row 6:
/// burn IF shares on per-day loss ≥ max(1% of TVL, 10_000 USDC).
/// Phase 4 hardcodes the absolute floor (10_000 USDC at 6-dec) — the
/// fraction-of-TVL piece lands when we wire per-market TVL into the
/// watchdog. Both apply via `max(a, b)`; the larger floor wins.
pub const INSURANCE_FUND_FLOOR_USDC_E6: i128 = 10_000_000_000;

/// Watchdog state — built once at boot, run in its own task.
pub struct InsuranceFundWatchdog {
    db: PerpsDb,
    poll: Duration,
    floor_usdc_e6: i128,
}

impl InsuranceFundWatchdog {
    /// Construct with defaults.
    pub fn new(db: PerpsDb) -> Self {
        Self {
            db,
            poll: Duration::from_secs(INSURANCE_FUND_POLL_SECS),
            floor_usdc_e6: INSURANCE_FUND_FLOOR_USDC_E6,
        }
    }

    /// Run forever (until the parent task cancels us).
    pub async fn run(self) {
        loop {
            if let Err(e) = self.tick().await {
                warn!(error = ?e, "insurance fund watchdog tick failed; backing off");
            }
            sleep(self.poll).await;
        }
    }

    async fn tick(&self) -> Result<(), sqlx::Error> {
        // Pull every row with a same-day loss past the floor (most negative first).
        // sqlx-sqlite can't bind i128 directly; cast via i64 (the floor is well
        // within i64 — 10_000 USDC at 6-dec is 10^10, fits with 9 orders of
        // headroom).
        let floor_i64: i64 = self
            .floor_usdc_e6
            .try_into()
            .unwrap_or(i64::MAX);
        let rows = sqlx::query(
            r#"
            select market_id, day_unix, realised_pnl_e6
            from lp_realised_pnl
            where cast(realised_pnl_e6 as integer) < ?1
            order by cast(realised_pnl_e6 as integer) asc
            "#,
        )
        .bind(-floor_i64)
        .fetch_all(self.db.pool())
        .await?;

        if rows.is_empty() {
            debug!("insurance fund watchdog: no breach this poll");
            return Ok(());
        }

        for row in rows {
            let market: String = row.try_get("market_id")?;
            let day: i64 = row.try_get("day_unix")?;
            let pnl_str: String = row.try_get("realised_pnl_e6")?;
            warn!(
                market,
                day,
                realised_pnl_e6 = pnl_str,
                floor_usdc_e6 = self.floor_usdc_e6,
                "INVARIANT 6 BREACH: LP same-day loss past IF burn floor — Path B will fire FxInsuranceFund.burnShares here"
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A construction smoke test — the real run-loop is exercised in the
    /// `#[ignore]`-gated live test once an LP_OPERATOR EOA is funded.
    #[tokio::test]
    async fn watchdog_constructs_with_default_floor() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let wd = InsuranceFundWatchdog::new(db);
        assert_eq!(wd.floor_usdc_e6, INSURANCE_FUND_FLOOR_USDC_E6);
    }

    #[tokio::test]
    async fn tick_returns_ok_when_no_realised_pnl_rows() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let wd = InsuranceFundWatchdog::new(db);
        wd.tick().await.unwrap();
    }

    #[tokio::test]
    async fn tick_warns_on_loss_past_floor() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        db.add_lp_realised_pnl(
            "0xaa",
            -(INSURANCE_FUND_FLOOR_USDC_E6 + 1),
            1_700_000_000,
        )
        .await
        .unwrap();
        let wd = InsuranceFundWatchdog::new(db);
        // The tick just emits tracing warnings — we assert it doesn't error.
        wd.tick().await.unwrap();
    }
}
