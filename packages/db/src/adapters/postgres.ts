/**
 * Postgres adapter (scaffolded).
 *
 * This adapter is wired into the `@bufi/db` public surface but every method
 * intentionally throws "not yet implemented". The DDL in `migrate()` mirrors
 * the sqlite schema using Postgres-flavored types (jsonb, bigint, boolean,
 * timestamptz). A future PR can fill in the bodies without changing any
 * call site.
 *
 * `pg` is an optional peer dependency: we never import the runtime package
 * statically, so consumers that only use sqlite never need to install it.
 * The local type-only shim below means typecheck works even if `@types/pg`
 * is not yet installed in the monorepo.
 */

import type {
  CreatePostgresTradingMachineDbOptions,
  DomainEventPersistence,
  PerpsIntentPersistence,
  ReceiptPersistence,
  TradingMachineDb,
  TradingMachineReadStore,
  WorkflowPersistence,
} from "../interfaces";

// Minimal local type surface for `pg`. We deliberately do NOT
// `import type { Pool } from "pg"` here because `@types/pg` may not be
// installed yet — keeping the shape local makes the scaffold compile in
// every workspace state. When the body of this adapter is implemented the
// author can swap these for the real `pg` types.
interface PgPoolLike {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  Pool: new (config: { connectionString: string }) => PgPoolLike;
}

const POSTGRES_PEER_MISSING_HINT =
  "@bufi/db postgres adapter requires the optional peer dependency `pg`. Install it in the consuming app (bun add pg) and add `@types/pg` to dev deps.";

function loadPgModule(): PgModuleLike {
  // Use a runtime `require` indirection so bundlers / static analysis don't
  // pull `pg` into projects that only use the sqlite adapter.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = Function("m", "return require(m)") as (moduleId: string) => unknown;
    return req("pg") as PgModuleLike;
  } catch (cause) {
    throw new Error(POSTGRES_PEER_MISSING_HINT, { cause: cause as Error });
  }
}

function notYetImplemented(methodName: string): never {
  throw new Error(`postgres adapter: ${methodName} not yet implemented`);
}

function createPerpsIntentStore(_pool: PgPoolLike): PerpsIntentPersistence {
  return {
    async put(_intent) {
      // TODO: insert into perp_order_intents using parameterized $1..$N placeholders
      notYetImplemented("perpsIntents.put");
    },
    async get(_intentId) {
      // TODO: select * from perp_order_intents where intent_id = $1
      notYetImplemented("perpsIntents.get");
    },
    async getByTraderNonce(_trader, _nonce) {
      // TODO: select * from perp_order_intents where trader_nonce_key = $1
      notYetImplemented("perpsIntents.getByTraderNonce");
    },
    async list(_filter) {
      // TODO: select * with parameterized null-aware predicates (coalesce / case)
      notYetImplemented("perpsIntents.list");
    },
    async updateStatus(_intentId, _status) {
      // TODO: update perp_order_intents set status=$1, updated_at=now() where intent_id=$2 returning *
      notYetImplemented("perpsIntents.updateStatus");
    },
    async recordFill(_intentId, _fillSizeDelta) {
      // TODO: load -> applyFillToIntent -> update perp_order_intents ... returning *
      notYetImplemented("perpsIntents.recordFill");
    },
  };
}

function createWorkflowStore(_pool: PgPoolLike): WorkflowPersistence {
  return {
    async create(_state) {
      // TODO: insert into workflow_states (workflow_id, actor, status, state_json, updated_at)
      // values ($1, $2, $3, $4::jsonb, $5) on conflict do nothing -- explicit duplicate check first
      notYetImplemented("workflows.create");
    },
    async get(_workflowId) {
      // TODO: select * from workflow_states where workflow_id = $1
      notYetImplemented("workflows.get");
    },
    async put(_state) {
      // TODO: update workflow_states set ... where workflow_id = $5 (throw if rowCount === 0)
      notYetImplemented("workflows.put");
    },
    async list(_filter) {
      // TODO: select with null-aware actor/status predicates
      notYetImplemented("workflows.list");
    },
  };
}

function createReceiptStore(_pool: PgPoolLike): ReceiptPersistence {
  return {
    async put(_toolName, _receipt) {
      // TODO: insert into x402_receipts (...) values (...) on conflict (receipt_id) do nothing
      notYetImplemented("receipts.put");
    },
    async list(_filter) {
      // TODO: parameterized select with case-insensitive payer match (lower(payer) = lower($2))
      notYetImplemented("receipts.list");
    },
    async has(_receiptId) {
      // TODO: select 1 from x402_receipts where receipt_id = $1
      notYetImplemented("receipts.has");
    },
    async get(_receiptId) {
      // TODO: select * from x402_receipts where receipt_id = $1
      notYetImplemented("receipts.get");
    },
  };
}

function createDomainEventStore(_pool: PgPoolLike): DomainEventPersistence {
  return {
    async put(_event) {
      // TODO: insert into domain_events (...) values (..., $6::jsonb) on conflict (event_id) do nothing
      notYetImplemented("events.put");
    },
    async get(_eventId) {
      // TODO: select * from domain_events where event_id = $1
      notYetImplemented("events.get");
    },
    async list(_filter) {
      // TODO: select with parameterized type/actor/aggregate/after filters and limit
      notYetImplemented("events.list");
    },
  };
}

function createPostgresReadStore(_pool: PgPoolLike): TradingMachineReadStore {
  return {
    async markets(_chainId) {
      // TODO: read from market_registry materialized view / table
      notYetImplemented("readStore.markets");
    },
    async perpPositions(_address) {
      // TODO: aggregate from perp_order_intents + fills
      notYetImplemented("readStore.perpPositions");
    },
    async perpIntent(_intentId) {
      // TODO: select * from perp_order_intents where intent_id = $1
      notYetImplemented("readStore.perpIntent");
    },
    async bentoRooms(_status) {
      // TODO: select * from bento_rooms where ($1::text is null or status = $1)
      notYetImplemented("readStore.bentoRooms");
    },
    async bentoRoom(_roomId) {
      // TODO: select * from bento_rooms where room_id = $1
      notYetImplemented("readStore.bentoRoom");
    },
    async telaranaPositions(_address) {
      // TODO: select * from fx_loan_positions where lower(address) = lower($1)
      notYetImplemented("readStore.telaranaPositions");
    },
  };
}

/**
 * DDL for the Postgres adapter. Mirrors the sqlite schema but uses
 * Postgres-native types: `bigserial`/`bigint` for ids and numeric counters,
 * `boolean` instead of integer flags, `jsonb` for blob columns, `timestamptz`
 * for timestamp columns.
 *
 * Exposed for migration tooling and tests. Safe to run multiple times
 * thanks to `create table if not exists` / `create index if not exists`.
 */
export async function migrate(pool: PgPoolLike): Promise<void> {
  await pool.query(`
    create table if not exists perp_order_intents (
      intent_id text primary key,
      replacement_of text,
      trader_nonce_key text not null unique,
      chain_id bigint not null,
      trader text not null,
      market_id text not null,
      side text not null,
      size_usdc text not null,
      size_delta text not null,
      filled_size_delta text not null default '0',
      remaining_size_delta text not null default '0',
      leverage integer not null,
      order_type text not null,
      price_e18 text not null,
      limit_price text,
      reduce_only boolean not null,
      post_only boolean not null,
      flags bigint not null,
      digest text not null,
      signature text not null,
      nonce text not null,
      deadline bigint not null,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_perp_order_intents_trader
      on perp_order_intents (trader);
    create index if not exists idx_perp_order_intents_market_status
      on perp_order_intents (market_id, status);
    create index if not exists idx_perp_order_intents_replacement_of
      on perp_order_intents (replacement_of);

    create table if not exists workflow_states (
      workflow_id text primary key,
      actor text not null,
      status text not null,
      state_json jsonb not null,
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_workflow_states_actor
      on workflow_states (actor);
    create index if not exists idx_workflow_states_status
      on workflow_states (status);

    create table if not exists x402_receipts (
      receipt_id text primary key,
      tool_name text not null,
      payer text not null,
      amount_usdc text not null,
      settlement_tx text not null,
      network text not null,
      paid_at_unix_seconds bigint not null,
      receipt_json jsonb not null
    );

    create index if not exists idx_x402_receipts_tool
      on x402_receipts (tool_name);
    create index if not exists idx_x402_receipts_payer
      on x402_receipts (payer);

    create table if not exists domain_events (
      event_id text primary key,
      type text not null,
      aggregate_id text not null,
      actor text,
      created_at bigint not null,
      payload_json jsonb not null
    );

    create index if not exists idx_domain_events_type_created
      on domain_events (type, created_at);
    create index if not exists idx_domain_events_actor_created
      on domain_events (actor, created_at);
    create index if not exists idx_domain_events_aggregate
      on domain_events (aggregate_id);
  `);
}

/**
 * Create a Postgres-backed `TradingMachineDb`.
 *
 * The connection pool is opened eagerly so call sites fail fast on a bad
 * `connectionString`. Method bodies are scaffolded — they throw a clear
 * "not yet implemented" error so the public surface compiles and tests
 * can verify wiring without a live database.
 */
export function createPostgresTradingMachineDb(
  opts: CreatePostgresTradingMachineDbOptions,
): TradingMachineDb {
  if (!opts.connectionString) {
    throw new Error("@bufi/db postgres adapter: connectionString is required");
  }
  const pgModule = loadPgModule();
  const pool = new pgModule.Pool({ connectionString: opts.connectionString });

  return {
    path: opts.connectionString,
    perpsIntents: createPerpsIntentStore(pool),
    workflows: createWorkflowStore(pool),
    receipts: createReceiptStore(pool),
    events: createDomainEventStore(pool),
    readStore: createPostgresReadStore(pool),
    close() {
      // `pg.Pool.end()` is async but the cross-adapter contract is sync.
      // Fire-and-forget the close; callers that need deterministic shutdown
      // can call `await pool.end()` themselves once this scaffold is filled
      // in (consider exposing a separate async `dispose()` then).
      void pool.end();
    },
  };
}

// Re-exported for tests / migration tooling that needs to construct a
// scaffolded store without spinning up a real pg pool.
export type { PgPoolLike };
