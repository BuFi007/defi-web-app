//! Embedded DDL — kept byte-equivalent to `migrate()` in
//! `packages/db/src/index.ts:431-530` so the Rust adapter and the bun:sqlite
//! adapter produce identical schemas on a fresh DB.
//!
//! sqlx 0.8 only executes the first statement when you pass a multi-stmt
//! string to `query()`. `sqlx::raw_sql()` walks the script and fires each
//! statement in turn, which is what we need.

use sqlx::{Executor, SqlitePool};

use crate::store::PerpsDbError;

const SCHEMA: &str = r#"
pragma journal_mode = WAL;
pragma foreign_keys = ON;

create table if not exists perp_order_intents (
  intent_id text primary key,
  replacement_of text,
  trader_nonce_key text not null unique,
  chain_id integer not null,
  trader text not null,
  market_id text not null,
  side text not null,
  size_usdc text not null,
  size_delta text not null default '0',
  filled_size_delta text not null default '0',
  remaining_size_delta text not null default '0',
  leverage integer not null,
  order_type text not null,
  price_e18 text not null default '0',
  limit_price text,
  reduce_only integer not null,
  post_only integer not null default 0,
  flags integer not null default 0,
  digest text not null,
  signature text not null,
  nonce text not null,
  deadline integer not null,
  status text not null,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists idx_perp_order_intents_trader
  on perp_order_intents (trader);

create index if not exists idx_perp_order_intents_market_status
  on perp_order_intents (market_id, status);

create index if not exists idx_perp_order_intents_replacement_of
  on perp_order_intents (replacement_of);

create table if not exists domain_events (
  event_id text primary key,
  type text not null,
  aggregate_id text not null,
  actor text,
  created_at integer not null,
  payload_json text not null
);

create index if not exists idx_domain_events_type_created
  on domain_events (type, created_at);

create index if not exists idx_domain_events_aggregate
  on domain_events (aggregate_id);

-- ============================================================
-- Phase 4 — synthetic LP backstop (Path A in the Option-C hybrid)
-- ============================================================
--
-- One row per market. The matcher updates `long_e18` / `short_e18` /
-- `avg_intent_size_e18` whenever it routes a fill to the LP. TVL is the
-- LP_OPERATOR EOA's USDC balance on FxMarginAccount, mirrored here so
-- the cap math doesn't have to RPC on every tick.
--
-- All bigints stored as text (same convention as `perp_order_intents`).

create table if not exists lp_positions (
  market_id        text primary key,
  chain_id         integer not null,
  tvl_usdc_e6      text not null default '0',
  long_e18         text not null default '0',
  short_e18        text not null default '0',
  avg_intent_size_e18 text not null default '0',
  enabled          integer not null default 1,
  updated_at       integer not null
);

create index if not exists idx_lp_positions_chain on lp_positions (chain_id);

-- One row per (market, day) of realised PnL. The IF watchdog reads this
-- to decide when to fire invariant 6.
create table if not exists lp_realised_pnl (
  market_id   text not null,
  day_unix    integer not null,
  realised_pnl_e6 text not null default '0',
  created_at  integer not null,
  updated_at  integer not null,
  primary key (market_id, day_unix)
);
"#;

pub(crate) async fn migrate(pool: &SqlitePool) -> Result<(), PerpsDbError> {
    let mut conn = pool.acquire().await?;
    conn.execute(sqlx::raw_sql(SCHEMA)).await?;
    Ok(())
}
