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
"#;

pub(crate) async fn migrate(pool: &SqlitePool) -> Result<(), PerpsDbError> {
    let mut conn = pool.acquire().await?;
    conn.execute(sqlx::raw_sql(SCHEMA)).await?;
    Ok(())
}
