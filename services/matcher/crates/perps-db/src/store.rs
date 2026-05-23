//! `PerpsDb` — async SQLite wrapper for `perp_order_intents`.
//!
//! `record_fill` mirrors `applyFillToIntent` in `packages/db/src/index.ts:565-585`:
//! same-sign check, no-zero-fill guard, residual = total − next_filled,
//! status flips to `filled` when residual hits zero. Transactional so the
//! Rust matcher and the TS keeper can both run against the same DB until
//! Phase 3d completes.

use std::env;
use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::{ConnectOptions, Row};
use thiserror::Error;

use crate::intent::{PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide};
use crate::migrate;

/// Errors surfaced by `PerpsDb`.
#[derive(Debug, Error)]
pub enum PerpsDbError {
    /// Wraps any underlying sqlx error.
    #[error("sqlx: {0}")]
    Sqlx(#[from] sqlx::Error),
    /// Row contained a column the Rust mapper couldn't decode.
    #[error("invalid row: {0}")]
    InvalidRow(String),
    /// Fill arithmetic guard from `applyFillToIntent`.
    #[error("invalid fill for {intent_id}: {reason}")]
    InvalidFill {
        /// The intent that failed.
        intent_id: String,
        /// Why.
        reason: String,
    },
    /// Caller asked for an intent that doesn't exist.
    #[error("intent {0} not found")]
    NotFound(String),
}

/// Async SQLite handle.
#[derive(Debug, Clone)]
pub struct PerpsDb {
    pool: SqlitePool,
}

impl PerpsDb {
    /// Open the DB at the explicit path. Creates it (and its parent dir)
    /// if missing. WAL + foreign-keys are enabled by `migrate`.
    ///
    /// In-memory paths (`:memory:`) get a single-connection pool — every
    /// connection in a multi-conn pool has its own private in-memory DB,
    /// so a migration on one conn isn't visible to the others.
    pub async fn open(path: &str) -> Result<Self, PerpsDbError> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            // Quiet noisy "PRAGMA …" logs in dev runs of the matcher.
            .disable_statement_logging();
        let max_conns = if path == ":memory:" { 1 } else { 8 };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_conns)
            .connect_with(opts)
            .await?;
        migrate::migrate(&pool).await?;
        Ok(Self { pool })
    }

    /// Open an in-memory DB — used by tests + ephemeral integrations.
    pub async fn open_in_memory() -> Result<Self, PerpsDbError> {
        Self::open(":memory:").await
    }

    /// Honour the same env-var precedence as `sqlitePathFromEnv` in
    /// `packages/db/src/index.ts:117-133`.
    pub async fn open_from_env() -> Result<Self, PerpsDbError> {
        let path = sqlite_path_from_env().to_string_lossy().into_owned();
        Self::open(&path).await
    }

    /// Internal pool accessor (used by tests + future reconciler).
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// `INSERT OR REPLACE` — keeps the TS adapter's upsert semantics.
    pub async fn put(&self, intent: &PerpIntent) -> Result<(), PerpsDbError> {
        sqlx::query(
            r#"
            insert or replace into perp_order_intents
              (intent_id, replacement_of, trader_nonce_key, chain_id, trader,
               market_id, side, size_usdc, size_delta, filled_size_delta,
               remaining_size_delta, leverage, order_type, price_e18,
               limit_price, reduce_only, post_only, flags, digest, signature,
               nonce, deadline, status, created_at, updated_at)
            values
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
               ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
               ?21, ?22, ?23, ?24, ?25)
            "#,
        )
        .bind(&intent.intent_id)
        .bind(&intent.replacement_of)
        .bind(trader_nonce_key(&intent.trader, &intent.nonce))
        .bind(intent.chain_id)
        .bind(&intent.trader)
        .bind(&intent.market_id)
        .bind(intent.side.as_str())
        .bind(&intent.size_usdc)
        .bind(&intent.size_delta)
        .bind(&intent.filled_size_delta)
        .bind(&intent.remaining_size_delta)
        .bind(intent.leverage)
        .bind(intent.order_type.as_str())
        .bind(&intent.price_e18)
        .bind(&intent.limit_price)
        .bind(intent.reduce_only as i64)
        .bind(intent.post_only as i64)
        .bind(intent.flags)
        .bind(&intent.digest)
        .bind(&intent.signature)
        .bind(&intent.nonce)
        .bind(intent.deadline)
        .bind(intent.status.as_str())
        .bind(intent.created_at)
        .bind(intent.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Get by primary key.
    pub async fn get(&self, intent_id: &str) -> Result<Option<PerpIntent>, PerpsDbError> {
        let row = sqlx::query("select * from perp_order_intents where intent_id = ?1")
            .bind(intent_id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(r) => Ok(Some(row_to_intent(&r)?)),
            None => Ok(None),
        }
    }

    /// `WHERE chain_id = ? AND status = 'pending' AND deadline > ?` ordered
    /// by `created_at ASC` (FIFO arrival). Equivalent to
    /// `db.perpsIntents.list({ status: "pending" }).filter(chainId)` plus the
    /// expiry filter the TS keeper applies inline.
    pub async fn list_pending(
        &self,
        chain_id: i64,
        now_secs: i64,
    ) -> Result<Vec<PerpIntent>, PerpsDbError> {
        let rows = sqlx::query(
            r#"
            select * from perp_order_intents
            where chain_id = ?1 and status = 'pending' and deadline > ?2
            order by created_at asc
            "#,
        )
        .bind(chain_id)
        .bind(now_secs)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_intent).collect()
    }

    /// Set status + bump `updated_at`. Returns the post-update row.
    pub async fn update_status(
        &self,
        intent_id: &str,
        status: PerpIntentStatus,
        now_secs: i64,
    ) -> Result<PerpIntent, PerpsDbError> {
        let affected = sqlx::query(
            r#"
            update perp_order_intents
            set status = ?1, updated_at = ?2
            where intent_id = ?3
            "#,
        )
        .bind(status.as_str())
        .bind(now_secs)
        .bind(intent_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if affected == 0 {
            return Err(PerpsDbError::NotFound(intent_id.to_string()));
        }
        self.get(intent_id)
            .await?
            .ok_or_else(|| PerpsDbError::NotFound(intent_id.to_string()))
    }

    /// Apply a fill and persist the new (filled_size_delta, remaining_size_delta,
    /// status). Transactional; mirrors `applyFillToIntent` exactly.
    pub async fn record_fill(
        &self,
        intent_id: &str,
        fill_size_delta: i128,
        now_secs: i64,
    ) -> Result<PerpIntent, PerpsDbError> {
        if fill_size_delta == 0 {
            return Err(PerpsDbError::InvalidFill {
                intent_id: intent_id.to_string(),
                reason: "fill size must be nonzero".into(),
            });
        }

        let mut tx = self.pool.begin().await?;

        // SQLite has no SELECT FOR UPDATE — the tx itself takes a write lock
        // on first DML (the UPDATE below), and concurrent writers serialise.
        let row = sqlx::query("select * from perp_order_intents where intent_id = ?1")
            .bind(intent_id)
            .fetch_optional(&mut *tx)
            .await?;
        let current = match row {
            Some(r) => row_to_intent(&r)?,
            None => return Err(PerpsDbError::NotFound(intent_id.to_string())),
        };

        let total: i128 = current.size_delta.parse().map_err(|_| {
            PerpsDbError::InvalidRow(format!("size_delta not parseable: {}", current.size_delta))
        })?;
        let prev_filled: i128 = current.filled_size_delta.parse().map_err(|_| {
            PerpsDbError::InvalidRow(format!(
                "filled_size_delta not parseable: {}",
                current.filled_size_delta
            ))
        })?;

        if !same_sign(total, fill_size_delta) {
            return Err(PerpsDbError::InvalidFill {
                intent_id: intent_id.to_string(),
                reason: "fill sign does not match order side".into(),
            });
        }
        let next_filled = prev_filled.saturating_add(fill_size_delta);
        if !same_sign(total, next_filled) || next_filled.unsigned_abs() > total.unsigned_abs() {
            return Err(PerpsDbError::InvalidFill {
                intent_id: intent_id.to_string(),
                reason: "fill exceeds remaining order quantity".into(),
            });
        }
        let remaining = total - next_filled;
        let status = if remaining == 0 {
            PerpIntentStatus::Filled
        } else {
            PerpIntentStatus::PartiallyFilled
        };

        sqlx::query(
            r#"
            update perp_order_intents
            set filled_size_delta = ?1,
                remaining_size_delta = ?2,
                status = ?3,
                updated_at = ?4
            where intent_id = ?5
            "#,
        )
        .bind(next_filled.to_string())
        .bind(remaining.to_string())
        .bind(status.as_str())
        .bind(now_secs)
        .bind(intent_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        self.get(intent_id)
            .await?
            .ok_or_else(|| PerpsDbError::NotFound(intent_id.to_string()))
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn row_to_intent(row: &sqlx::sqlite::SqliteRow) -> Result<PerpIntent, PerpsDbError> {
    let side_str: String = row.try_get("side")?;
    let order_type_str: String = row.try_get("order_type")?;
    let status_str: String = row.try_get("status")?;
    let reduce_only_i: i64 = row.try_get("reduce_only")?;
    let post_only_i: i64 = row.try_get("post_only")?;

    Ok(PerpIntent {
        intent_id: row.try_get("intent_id")?,
        replacement_of: row.try_get("replacement_of")?,
        chain_id: row.try_get("chain_id")?,
        trader: row.try_get("trader")?,
        market_id: row.try_get("market_id")?,
        side: PerpSide::from_db_text(&side_str)
            .ok_or_else(|| PerpsDbError::InvalidRow(format!("unknown side: {side_str}")))?,
        size_usdc: row.try_get("size_usdc")?,
        size_delta: row.try_get("size_delta")?,
        filled_size_delta: row.try_get("filled_size_delta")?,
        remaining_size_delta: row.try_get("remaining_size_delta")?,
        leverage: row.try_get("leverage")?,
        order_type: PerpOrderType::from_db_text(&order_type_str).ok_or_else(|| {
            PerpsDbError::InvalidRow(format!("unknown order_type: {order_type_str}"))
        })?,
        price_e18: row.try_get("price_e18")?,
        limit_price: row.try_get("limit_price")?,
        reduce_only: reduce_only_i != 0,
        post_only: post_only_i != 0,
        flags: row.try_get("flags")?,
        digest: row.try_get("digest")?,
        signature: row.try_get("signature")?,
        nonce: row.try_get("nonce")?,
        deadline: row.try_get("deadline")?,
        status: PerpIntentStatus::from_db_text(&status_str)
            .ok_or_else(|| PerpsDbError::InvalidRow(format!("unknown status: {status_str}")))?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn trader_nonce_key(trader: &str, nonce: &str) -> String {
    format!("{}:{}", trader.to_lowercase(), nonce)
}

fn same_sign(a: i128, b: i128) -> bool {
    (a > 0 && b > 0) || (a < 0 && b < 0)
}

/// Mirrors `sqlitePathFromEnv` from `packages/db/src/index.ts:117-133`.
fn sqlite_path_from_env() -> PathBuf {
    if let Some(p) = env::var_os("BUFI_DB_PATH").or_else(|| env::var_os("TRADING_MACHINE_DB_PATH"))
    {
        return PathBuf::from(p);
    }
    if let Ok(url) = env::var("DATABASE_URL") {
        if let Some(rest) = url.strip_prefix("sqlite://") {
            return PathBuf::from(rest);
        }
        if let Some(rest) = url.strip_prefix("file:") {
            return PathBuf::from(rest);
        }
        if env::var("NODE_ENV").as_deref() != Ok("production") {
            return PathBuf::from(".bufi/trading-machine.sqlite");
        }
    }
    PathBuf::from(".bufi/trading-machine.sqlite")
}
