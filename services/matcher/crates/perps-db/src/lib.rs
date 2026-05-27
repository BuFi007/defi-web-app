//! SQLite store for `perp_order_intents`.
//!
//! Mirrors `@bufi/db` (bun:sqlite, `packages/db/src/index.ts`) so the Rust
//! matcher reads the same SQLite file that `apps/api` writes. The former TS
//! keeper was retired; this crate is the single DB layer for matcher-side
//! intent consumption.
//!
//! ## Why SQLite, not Postgres
//!
//! The API imports `createTradingMachineDbFromEnv` from `@bufi/db`, which is a
//! `bun:sqlite` adapter. Path resolution honours
//! `BUFI_DB_PATH` → `TRADING_MACHINE_DB_PATH` →
//! `DATABASE_URL=sqlite://…` → `.bufi/trading-machine.sqlite`. Until the
//! Postgres migration on `feat/wk1j-db-postgres-ready` lands, the Rust
//! matcher MUST read the same SQLite file.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod intent;
mod lp;
mod migrate;
mod store;

pub use intent::{PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide};
pub use lp::{LpPosition, LpRealisedPnlRow, LpStorageError};
pub use store::{PerpsDb, PerpsDbError};
