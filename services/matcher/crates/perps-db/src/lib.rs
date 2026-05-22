//! SQLite store for `perp_order_intents`.
//!
//! Mirrors `@bufi/db` (bun:sqlite, `packages/db/src/index.ts`) so the Rust
//! matcher and the TS keeper at `apps/keeper-perps-matcher/` can run
//! against the same SQLite file during the Phase 3 cutover. Once Phase 3d
//! deletes the TS keeper, this crate stays as the single DB layer.
//!
//! ## Why SQLite, not Postgres
//!
//! The TS keeper today imports `createTradingMachineDbFromEnv` from
//! `@bufi/db`, which is a `bun:sqlite` adapter. Path resolution honours
//! `BUFI_DB_PATH` → `TRADING_MACHINE_DB_PATH` →
//! `DATABASE_URL=sqlite://…` → `.bufi/trading-machine.sqlite`. Until the
//! Postgres migration on `feat/wk1j-db-postgres-ready` lands, the Rust
//! matcher MUST read the same SQLite file.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod intent;
mod migrate;
mod store;

pub use intent::{PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide};
pub use store::{PerpsDb, PerpsDbError};
