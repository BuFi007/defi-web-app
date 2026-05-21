// Public surface for `@bufi/db`.
//
// The package exposes adapter-agnostic interfaces (in `./interfaces`) plus
// two concrete adapters: `bun:sqlite` (default, production today) and a
// Postgres scaffold (`./adapters/postgres`). Call sites should depend on
// `TradingMachineDb` rather than a specific adapter.

export type {
  CreatePostgresTradingMachineDbOptions,
  CreateSqliteTradingMachineDbOptions,
  DomainEventPersistence,
  PaymentReceiptRecord,
  PerpsIntentPersistence,
  ReceiptPersistence,
  StoredPaymentReceiptRecord,
  TradingMachineDb,
  TradingMachineReadStore,
  WorkflowPersistence,
} from "./interfaces";

export {
  createSqliteTradingMachineDb,
  createUnavailableReadStore,
  databaseUrlFromEnv,
  sqlitePathFromEnv,
} from "./adapters/sqlite";

export { createPostgresTradingMachineDb } from "./adapters/postgres";

import type { TradingMachineDb } from "./interfaces";
import {
  createSqliteTradingMachineDb,
  databaseUrlFromEnv,
  sqlitePathFromEnv,
} from "./adapters/sqlite";
import { createPostgresTradingMachineDb } from "./adapters/postgres";

/**
 * Construct a `TradingMachineDb` from environment variables.
 *
 * Routing rules:
 *   1. If `DATABASE_URL` (or `DATABASE_PRIVATE_URL`) starts with
 *      `postgres://` or `postgresql://`, use the Postgres adapter.
 *   2. Otherwise (sqlite://, file:, BUFI_DB_PATH, or unset) fall back to
 *      the bun:sqlite adapter — current production default.
 *
 * Backward compatible with the original sqlite-only behavior.
 */
export function createTradingMachineDbFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TradingMachineDb {
  const url = databaseUrlFromEnv(env);
  if (url && (url.startsWith("postgres://") || url.startsWith("postgresql://"))) {
    return createPostgresTradingMachineDb({ connectionString: url });
  }
  return createSqliteTradingMachineDb({ path: sqlitePathFromEnv(env) });
}
