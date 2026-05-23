//! Path A LP storage — synthetic per-market LP state in SQLite.
//!
//! Phase 4 ships Path A behind the `LpStateView` trait in
//! `bufi_orderbook::lp`. The on-chain Path B (FxPerpLpVault) will land
//! later; the row shape and accessor API here are designed to stay stable
//! when Path B is bolted on (Path B reads from the contract; Path A reads
//! from this table; same `LpSnapshot` exits either way).

use serde::{Deserialize, Serialize};
use sqlx::Row;
use thiserror::Error;

use crate::store::{PerpsDb, PerpsDbError};

/// One LP-position row (one per market).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LpPosition {
    /// `bytes32` market id, lowercase hex with `0x` prefix.
    pub market_id: String,
    /// Chain id (e.g. `5_042_002` for Arc Testnet).
    pub chain_id: i64,
    /// USDC balance backing the LP, 6-dec quantums (text-encoded).
    pub tvl_usdc_e6: String,
    /// LP long-side notional, 18-dec WAD (text-encoded).
    pub long_e18: String,
    /// LP short-side notional, 18-dec WAD (text-encoded).
    pub short_e18: String,
    /// Recent-history per-intent volume average, 18-dec WAD (text-encoded).
    /// `"0"` means "no history" — the spread function falls back to
    /// `base_spread_bps` only.
    pub avg_intent_size_e18: String,
    /// LP-enabled flag (invariant 10).
    pub enabled: bool,
    /// Unix seconds of last write.
    pub updated_at: i64,
}

/// Realised-PnL row (one per market per UTC day).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LpRealisedPnlRow {
    /// `bytes32` market id, lowercase hex.
    pub market_id: String,
    /// UTC day expressed as `unix_secs / 86400`.
    pub day_unix: i64,
    /// Cumulative realised PnL for the day, 6-dec USDC (signed text).
    pub realised_pnl_e6: String,
    /// Unix seconds at first write.
    pub created_at: i64,
    /// Unix seconds at last write.
    pub updated_at: i64,
}

/// LP-side errors. Wraps `PerpsDbError` for the IO surface.
#[derive(Debug, Error)]
pub enum LpStorageError {
    /// Underlying sqlx / row-mapping failure.
    #[error(transparent)]
    Db(#[from] PerpsDbError),
    /// sqlx error not surfaced via `PerpsDbError`.
    #[error("sqlx: {0}")]
    Sqlx(#[from] sqlx::Error),
    /// Row contained a column the mapper couldn't decode.
    #[error("invalid row: {0}")]
    InvalidRow(String),
}

impl PerpsDb {
    /// Insert or replace an LP row. Used by the LP_OPERATOR boot sequence
    /// + by `record_lp_fill` to update state atomically.
    pub async fn put_lp_position(&self, p: &LpPosition) -> Result<(), LpStorageError> {
        sqlx::query(
            r#"
            insert or replace into lp_positions
              (market_id, chain_id, tvl_usdc_e6, long_e18, short_e18,
               avg_intent_size_e18, enabled, updated_at)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(&p.market_id)
        .bind(p.chain_id)
        .bind(&p.tvl_usdc_e6)
        .bind(&p.long_e18)
        .bind(&p.short_e18)
        .bind(&p.avg_intent_size_e18)
        .bind(p.enabled as i64)
        .bind(p.updated_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Fetch a single LP row by market id.
    pub async fn get_lp_position(
        &self,
        market_id: &str,
    ) -> Result<Option<LpPosition>, LpStorageError> {
        let row = sqlx::query("select * from lp_positions where market_id = ?1")
            .bind(market_id)
            .fetch_optional(self.pool())
            .await?;
        match row {
            None => Ok(None),
            Some(r) => Ok(Some(row_to_lp_position(&r)?)),
        }
    }

    /// Apply a fill to the LP row atomically. The matcher MUST call this
    /// after a successful LP-side settle so the next tick reads fresh state.
    ///
    /// `taker_side_was_long` says whether the taker took Long (so the LP
    /// took Short). `fill_e18` is the magnitude.
    pub async fn record_lp_fill(
        &self,
        market_id: &str,
        taker_side_was_long: bool,
        fill_e18: u128,
        now_secs: i64,
    ) -> Result<LpPosition, LpStorageError> {
        let mut tx = self.pool().begin().await?;
        let row = sqlx::query("select * from lp_positions where market_id = ?1")
            .bind(market_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(row) = row else {
            return Err(LpStorageError::InvalidRow(format!(
                "lp_positions row missing for market {market_id}"
            )));
        };
        let mut current = row_to_lp_position(&row)?;
        let cur_long: u128 = current.long_e18.parse().unwrap_or(0);
        let cur_short: u128 = current.short_e18.parse().unwrap_or(0);

        // Taker Long → LP took Short. Taker Short → LP took Long.
        let (new_long, new_short) = if taker_side_was_long {
            (cur_long, cur_short.saturating_add(fill_e18))
        } else {
            (cur_long.saturating_add(fill_e18), cur_short)
        };

        // EMA-style average. Cheap rolling stat without a separate window.
        // alpha = 1/8 (recent fill carries 12.5% weight).
        let cur_avg: u128 = current.avg_intent_size_e18.parse().unwrap_or(0);
        let new_avg = if cur_avg == 0 {
            fill_e18
        } else {
            (cur_avg.saturating_mul(7).saturating_add(fill_e18)) / 8
        };

        current.long_e18 = new_long.to_string();
        current.short_e18 = new_short.to_string();
        current.avg_intent_size_e18 = new_avg.to_string();
        current.updated_at = now_secs;

        sqlx::query(
            r#"
            update lp_positions
            set long_e18 = ?1,
                short_e18 = ?2,
                avg_intent_size_e18 = ?3,
                updated_at = ?4
            where market_id = ?5
            "#,
        )
        .bind(&current.long_e18)
        .bind(&current.short_e18)
        .bind(&current.avg_intent_size_e18)
        .bind(current.updated_at)
        .bind(market_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(current)
    }

    /// Add to (or subtract from) the realised-PnL row for the current
    /// UTC day. Used by the IF watchdog.
    pub async fn add_lp_realised_pnl(
        &self,
        market_id: &str,
        pnl_delta_e6: i128,
        now_secs: i64,
    ) -> Result<LpRealisedPnlRow, LpStorageError> {
        let day = now_secs / 86_400;
        let mut tx = self.pool().begin().await?;
        let existing = sqlx::query(
            "select realised_pnl_e6, created_at from lp_realised_pnl where market_id = ?1 and day_unix = ?2",
        )
        .bind(market_id)
        .bind(day)
        .fetch_optional(&mut *tx)
        .await?;
        let (cur, created_at) = match existing {
            Some(r) => {
                let cur_str: String = r.try_get("realised_pnl_e6")?;
                let cur: i128 = cur_str.parse().unwrap_or(0);
                let created: i64 = r.try_get("created_at")?;
                (cur, created)
            }
            None => (0i128, now_secs),
        };
        let updated = cur.saturating_add(pnl_delta_e6);
        sqlx::query(
            r#"
            insert into lp_realised_pnl
              (market_id, day_unix, realised_pnl_e6, created_at, updated_at)
            values (?1, ?2, ?3, ?4, ?5)
            on conflict (market_id, day_unix) do update set
              realised_pnl_e6 = excluded.realised_pnl_e6,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(market_id)
        .bind(day)
        .bind(updated.to_string())
        .bind(created_at)
        .bind(now_secs)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(LpRealisedPnlRow {
            market_id: market_id.to_string(),
            day_unix: day,
            realised_pnl_e6: updated.to_string(),
            created_at,
            updated_at: now_secs,
        })
    }
}

fn row_to_lp_position(row: &sqlx::sqlite::SqliteRow) -> Result<LpPosition, LpStorageError> {
    let enabled_i: i64 = row.try_get("enabled")?;
    Ok(LpPosition {
        market_id: row.try_get("market_id")?,
        chain_id: row.try_get("chain_id")?,
        tvl_usdc_e6: row.try_get("tvl_usdc_e6")?,
        long_e18: row.try_get("long_e18")?,
        short_e18: row.try_get("short_e18")?,
        avg_intent_size_e18: row.try_get("avg_intent_size_e18")?,
        enabled: enabled_i != 0,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::PerpsDb;

    const MARKET: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn sample(now: i64) -> LpPosition {
        LpPosition {
            market_id: MARKET.into(),
            chain_id: 5_042_002,
            tvl_usdc_e6: "1000000000000".into(), // 1,000,000 USDC
            long_e18: "0".into(),
            short_e18: "0".into(),
            avg_intent_size_e18: "0".into(),
            enabled: true,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn put_then_get_roundtrips() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let p = sample(1_700_000_000);
        db.put_lp_position(&p).await.unwrap();
        let got = db.get_lp_position(MARKET).await.unwrap().unwrap();
        assert_eq!(got, p);
    }

    #[tokio::test]
    async fn record_lp_fill_grows_short_when_taker_long() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        db.put_lp_position(&sample(1_700_000_000)).await.unwrap();
        let after = db
            .record_lp_fill(MARKET, true, 1_000_000_000_000_000_000, 1_700_000_001)
            .await
            .unwrap();
        assert_eq!(after.long_e18, "0");
        assert_eq!(after.short_e18, "1000000000000000000");
        assert_eq!(after.avg_intent_size_e18, "1000000000000000000");
    }

    #[tokio::test]
    async fn record_lp_fill_grows_long_when_taker_short() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        db.put_lp_position(&sample(1_700_000_000)).await.unwrap();
        let after = db
            .record_lp_fill(MARKET, false, 2_000_000_000_000_000_000, 1_700_000_001)
            .await
            .unwrap();
        assert_eq!(after.long_e18, "2000000000000000000");
        assert_eq!(after.short_e18, "0");
    }

    #[tokio::test]
    async fn realised_pnl_accumulates_within_day() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let now = 1_700_000_000i64;
        db.add_lp_realised_pnl(MARKET, 5_000_000, now).await.unwrap();
        let second = db
            .add_lp_realised_pnl(MARKET, -1_000_000, now + 60)
            .await
            .unwrap();
        assert_eq!(second.realised_pnl_e6, "4000000");
        // The created_at stays the same; updated_at advances.
        assert_eq!(second.created_at, now);
        assert_eq!(second.updated_at, now + 60);
    }
}
