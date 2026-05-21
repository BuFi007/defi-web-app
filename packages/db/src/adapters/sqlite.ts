import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { Database, type SQLQueryBindings } from "bun:sqlite";

import type { DomainEvent, PerpIntent, WorkflowState } from "@bufi/shared-types";

import type {
  CreateSqliteTradingMachineDbOptions,
  DomainEventPersistence,
  PaymentReceiptRecord,
  PerpsIntentPersistence,
  ReceiptPersistence,
  StoredPaymentReceiptRecord,
  TradingMachineDb,
  TradingMachineReadStore,
  WorkflowPersistence,
} from "../interfaces";

type Row = Record<string, unknown>;

export function createSqliteTradingMachineDb(
  opts: CreateSqliteTradingMachineDbOptions,
): TradingMachineDb {
  const dbPath = normalizeSqlitePath(opts.path);
  ensureParentDir(dbPath);
  const db = new Database(dbPath, { create: true, strict: true });
  migrate(db);

  return {
    path: dbPath,
    perpsIntents: createPerpsIntentStore(db),
    workflows: createWorkflowStore(db),
    receipts: createReceiptStore(db),
    events: createDomainEventStore(db),
    readStore: createSqliteReadStore(db),
    close() {
      db.close();
    },
  };
}

export function sqlitePathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.BUFI_DB_PATH ?? env.TRADING_MACHINE_DB_PATH;
  if (explicit) return explicit;

  const url = databaseUrlFromEnv(env);
  if (url?.startsWith("sqlite://")) return url.slice("sqlite://".length);
  if (url?.startsWith("file:")) return new URL(url).pathname;
  if (url) {
    if (env.NODE_ENV !== "production") {
      return ".bufi/trading-machine.sqlite";
    }
    throw new Error(
      "@bufi/db: only sqlite:// or file: DATABASE_URL values are supported by the Bun SQLite adapter; set BUFI_DB_PATH for local durable storage",
    );
  }
  return ".bufi/trading-machine.sqlite";
}

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DATABASE_PRIVATE_URL ?? env.DATABASE_URL ?? null;
}

export function createUnavailableReadStore(): TradingMachineReadStore {
  const unavailable = async () => {
    throw new Error("@bufi/db: read store is not configured");
  };
  return {
    markets: unavailable,
    perpPositions: unavailable,
    perpIntent: unavailable,
    bentoRooms: unavailable,
    bentoRoom: unavailable,
    telaranaPositions: unavailable,
  };
}

function createPerpsIntentStore(db: Database): PerpsIntentPersistence {
  const insert = db.query(`
    insert into perp_order_intents (
      intent_id, replacement_of, trader_nonce_key, chain_id, trader, market_id, side,
      size_usdc, size_delta, filled_size_delta, remaining_size_delta,
      leverage, order_type, price_e18, limit_price,
      reduce_only, post_only, flags,
      digest, signature, nonce, deadline, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.query("select * from perp_order_intents where intent_id = ?");
  const byTraderNonce = db.query("select * from perp_order_intents where trader_nonce_key = ?");
  const updateStatus = db.query(`
    update perp_order_intents
    set status = ?, updated_at = ?
    where intent_id = ?
  `);
  const updateFill = db.query(`
    update perp_order_intents
    set filled_size_delta = ?, remaining_size_delta = ?, status = ?, updated_at = ?
    where intent_id = ?
  `);
  const byFilter = db.query(`
    select * from perp_order_intents
    where (?1 is null or lower(trader) = ?1)
      and (?2 is null or status = ?2)
    order by created_at asc, intent_id asc
  `);

  return {
    async put(intent) {
      const existing = await this.get(intent.intentId);
      if (existing) return;
      const conflictingNonce = await this.getByTraderNonce(intent.trader, intent.nonce);
      if (conflictingNonce && conflictingNonce.intentId !== intent.intentId) {
        throw new Error(
          `nonce already used by ${intent.trader}: ${intent.nonce.toString()}`,
        );
      }
      const now = Math.floor(Date.now() / 1000);
      const createdAt = intent.createdAt || now;
      const updatedAt = intent.updatedAt || now;
      insert.run(
        intent.intentId,
        intent.replacementOf ?? null,
        traderNonceKey(intent.trader, intent.nonce),
        intent.chainId,
        intent.trader,
        intent.marketId,
        intent.side,
        intent.sizeUsdc,
        intent.sizeDelta,
        intent.filledSizeDelta,
        intent.remainingSizeDelta,
        intent.leverage,
        intent.orderType,
        intent.priceE18,
        intent.limitPrice ?? null,
        intent.reduceOnly ? 1 : 0,
        intent.postOnly ? 1 : 0,
        intent.flags,
        intent.digest,
        intent.signature,
        intent.nonce.toString(),
        intent.deadline,
        intent.status,
        createdAt,
        updatedAt,
      );
    },
    async get(intentId) {
      return rowToPerpIntent(byId.get(intentId) as Row | null);
    },
    async getByTraderNonce(trader, nonce) {
      return rowToPerpIntent(byTraderNonce.get(traderNonceKey(trader, nonce)) as Row | null);
    },
    async list(filter) {
      return (byFilter.all(
        filter?.trader?.toLowerCase() ?? null,
        filter?.status ?? null,
      ) as Row[]).map((row) => rowToPerpIntent(row)!);
    },
    async updateStatus(intentId, status) {
      const now = Math.floor(Date.now() / 1000);
      const result = updateStatus.run(status, now, intentId);
      if (result.changes === 0) throw new Error(`perps intent ${intentId} does not exist`);
      const updated = await this.get(intentId);
      if (!updated) throw new Error(`perps intent ${intentId} disappeared after status update`);
      return updated;
    },
    async recordFill(intentId, fillSizeDelta) {
      const existing = await this.get(intentId);
      if (!existing) throw new Error(`perps intent ${intentId} does not exist`);
      const filled = applyFillToIntent(existing, fillSizeDelta);
      const now = Math.floor(Date.now() / 1000);
      const result = updateFill.run(
        filled.filledSizeDelta,
        filled.remainingSizeDelta,
        filled.status,
        now,
        intentId,
      );
      if (result.changes === 0) throw new Error(`perps intent ${intentId} does not exist`);
      const updated = await this.get(intentId);
      if (!updated) throw new Error(`perps intent ${intentId} disappeared after fill update`);
      return updated;
    },
  };
}

function createWorkflowStore(db: Database): WorkflowPersistence {
  const insert = db.query(`
    insert into workflow_states (workflow_id, actor, status, state_json, updated_at)
    values (?, ?, ?, ?, ?)
  `);
  const update = db.query(`
    update workflow_states
    set actor = ?, status = ?, state_json = ?, updated_at = ?
    where workflow_id = ?
  `);
  const byId = db.query("select * from workflow_states where workflow_id = ?");
  const byFilter = db.query(`
    select * from workflow_states
    where (?1 is null or lower(actor) = ?1)
      and (?2 is null or status = ?2)
    order by updated_at desc, workflow_id desc
  `);

  return {
    async create(state) {
      if (await this.get(state.workflowId)) {
        throw new Error(`workflow ${state.workflowId} already exists`);
      }
      insert.run(
        state.workflowId,
        actorForWorkflow(state),
        state.status,
        encodeJson(state),
        state.updatedAt,
      );
    },
    async get(workflowId) {
      return rowToWorkflow(byId.get(workflowId) as Row | null);
    },
    async put(state) {
      const result = update.run(
        actorForWorkflow(state),
        state.status,
        encodeJson(state),
        state.updatedAt,
        state.workflowId,
      );
      if (result.changes === 0) {
        throw new Error(`workflow ${state.workflowId} does not exist`);
      }
    },
    async list(filter) {
      return (byFilter.all(
        filter?.actor?.toLowerCase() ?? null,
        filter?.status ?? null,
      ) as Row[]).map((row) => rowToWorkflow(row)!);
    },
  };
}

function createReceiptStore(db: Database): ReceiptPersistence {
  const insert = db.query(`
    insert into x402_receipts (
      receipt_id, tool_name, payer, amount_usdc, settlement_tx, network,
      paid_at_unix_seconds, receipt_json
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.query("select * from x402_receipts where receipt_id = ?");
  const byFilter = db.query(`
    select * from x402_receipts
    where (?1 is null or tool_name = ?1)
      and (?2 is null or lower(payer) = ?2)
    order by paid_at_unix_seconds desc, receipt_id desc
  `);

  return {
    async put(toolName, receipt) {
      if (await this.has(receipt.receiptId)) return;
      insert.run(
        receipt.receiptId,
        toolName,
        receipt.payer,
        receipt.amountUsdc,
        receipt.settlementTx,
        receipt.network,
        receipt.paidAtUnixSeconds,
        encodeJson(receipt),
      );
    },
    async list(filter) {
      return (byFilter.all(
        filter.toolName ?? null,
        filter.payer?.toLowerCase() ?? null,
      ) as Row[]).map((row) => rowToReceipt(row)!);
    },
    async has(receiptId) {
      return Boolean(byId.get(receiptId));
    },
    async get(receiptId) {
      return rowToReceipt(byId.get(receiptId) as Row | null);
    },
  };
}

function createDomainEventStore(db: Database): DomainEventPersistence {
  const insert = db.query(`
    insert into domain_events (
      event_id, type, aggregate_id, actor, created_at, payload_json
    ) values (?, ?, ?, ?, ?, ?)
  `);
  const byId = db.query("select * from domain_events where event_id = ?");
  const byFilter = db.query(`
    select * from domain_events
    where (?1 is null or type = ?1)
      and (?2 is null or lower(actor) = ?2)
      and (?3 is null or aggregate_id = ?3)
      and (?4 is null or created_at > ?4)
    order by created_at asc, event_id asc
    limit ?5
  `);

  return {
    async put(event) {
      if (await this.get(event.eventId)) return;
      insert.run(
        event.eventId,
        event.type,
        event.aggregateId,
        event.actor?.toLowerCase() ?? null,
        event.createdAt,
        encodeJson(event.payload),
      );
    },
    async get(eventId) {
      return rowToDomainEvent(byId.get(eventId) as Row | null);
    },
    async list(filter) {
      const limit = Math.max(1, Math.min(filter?.limit ?? 100, 500));
      return (byFilter.all(
        filter?.type ?? null,
        filter?.actor?.toLowerCase() ?? null,
        filter?.aggregateId ?? null,
        filter?.after ?? null,
        limit,
      ) as Row[]).map((row) => rowToDomainEvent(row)!);
    },
  };
}

function createSqliteReadStore(db: Database): TradingMachineReadStore {
  const perpsIntentById = db.query("select * from perp_order_intents where intent_id = ?");
  return {
    async markets() {
      return [];
    },
    async perpPositions() {
      return [];
    },
    async perpIntent(intentId) {
      return rowToPerpIntent(perpsIntentById.get(intentId) as Row | null);
    },
    async bentoRooms() {
      return [];
    },
    async bentoRoom() {
      return null;
    },
    async telaranaPositions() {
      return [];
    },
  };
}

function migrate(db: Database): void {
  db.exec(`
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
      size_delta text not null,
      filled_size_delta text not null default '0',
      remaining_size_delta text not null default '0',
      leverage integer not null,
      order_type text not null,
      price_e18 text not null,
      limit_price text,
      reduce_only integer not null,
      post_only integer not null,
      flags integer not null,
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

    create table if not exists workflow_states (
      workflow_id text primary key,
      actor text not null,
      status text not null,
      state_json text not null,
      updated_at integer not null
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
      paid_at_unix_seconds integer not null,
      receipt_json text not null
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
      created_at integer not null,
      payload_json text not null
    );

    create index if not exists idx_domain_events_type_created
      on domain_events (type, created_at);
    create index if not exists idx_domain_events_actor_created
      on domain_events (actor, created_at);
    create index if not exists idx_domain_events_aggregate
      on domain_events (aggregate_id);
  `);
  ensureColumn(db, "perp_order_intents", "size_delta", "text not null default '0'");
  ensureColumn(db, "perp_order_intents", "replacement_of", "text");
  ensureColumn(db, "perp_order_intents", "filled_size_delta", "text not null default '0'");
  ensureColumn(db, "perp_order_intents", "remaining_size_delta", "text not null default '0'");
  ensureColumn(db, "perp_order_intents", "price_e18", "text not null default '0'");
  ensureColumn(db, "perp_order_intents", "post_only", "integer not null default 0");
  ensureColumn(db, "perp_order_intents", "flags", "integer not null default 0");
  db.exec(`
    create index if not exists idx_perp_order_intents_replacement_of
      on perp_order_intents (replacement_of);
  `);
  db.exec(`
    update perp_order_intents
    set remaining_size_delta = size_delta
    where remaining_size_delta = '0' and filled_size_delta = '0' and size_delta != '0';
  `);
}

function rowToPerpIntent(row: Row | null): PerpIntent | null {
  if (!row) return null;
  const intent: PerpIntent = {
    intentId: String(row.intent_id),
    chainId: Number(row.chain_id) as PerpIntent["chainId"],
    trader: String(row.trader) as PerpIntent["trader"],
    marketId: String(row.market_id),
    side: String(row.side) as PerpIntent["side"],
    sizeUsdc: String(row.size_usdc),
    sizeDelta: String(row.size_delta),
    filledSizeDelta: String(row.filled_size_delta),
    remainingSizeDelta: String(row.remaining_size_delta),
    leverage: Number(row.leverage),
    orderType: String(row.order_type) as PerpIntent["orderType"],
    priceE18: String(row.price_e18),
    limitPrice: row.limit_price === null ? undefined : String(row.limit_price),
    reduceOnly: Boolean(row.reduce_only),
    postOnly: Boolean(row.post_only),
    flags: Number(row.flags),
    digest: String(row.digest) as PerpIntent["digest"],
    signature: String(row.signature) as PerpIntent["signature"],
    nonce: BigInt(String(row.nonce)),
    deadline: Number(row.deadline),
    status: String(row.status) as PerpIntent["status"],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.replacement_of !== null && row.replacement_of !== undefined) {
    intent.replacementOf = String(row.replacement_of);
  }
  return intent;
}

function applyFillToIntent(
  intent: PerpIntent,
  fillSizeDelta: bigint,
): Pick<PerpIntent, "filledSizeDelta" | "remainingSizeDelta" | "status"> {
  const total = BigInt(intent.sizeDelta);
  const previousFilled = BigInt(intent.filledSizeDelta);
  if (fillSizeDelta === 0n) throw new Error("fill size must be nonzero");
  if (!sameSign(total, fillSizeDelta)) {
    throw new Error(`fill sign does not match order side for ${intent.intentId}`);
  }
  const nextFilled = previousFilled + fillSizeDelta;
  if (!sameSign(total, nextFilled) || abs(nextFilled) > abs(total)) {
    throw new Error(`fill exceeds remaining order quantity for ${intent.intentId}`);
  }
  const remaining = total - nextFilled;
  return {
    filledSizeDelta: nextFilled.toString(),
    remainingSizeDelta: remaining.toString(),
    status: remaining === 0n ? "filled" : "partially_filled",
  };
}

function rowToWorkflow(row: Row | null): WorkflowState | null {
  if (!row) return null;
  return JSON.parse(String(row.state_json)) as WorkflowState;
}

function rowToReceipt(row: Row | null): StoredPaymentReceiptRecord | null {
  if (!row) return null;
  const receipt = JSON.parse(String(row.receipt_json)) as PaymentReceiptRecord;
  return { ...receipt, toolName: String(row.tool_name) };
}

function rowToDomainEvent(row: Row | null): DomainEvent | null {
  if (!row) return null;
  const event: DomainEvent = {
    eventId: String(row.event_id),
    type: String(row.type),
    aggregateId: String(row.aggregate_id),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: Number(row.created_at),
  };
  if (row.actor !== null && row.actor !== undefined) {
    event.actor = String(row.actor);
  }
  return event;
}

function actorForWorkflow(state: WorkflowState): string {
  return state.session.address?.toLowerCase() ?? "anon";
}

function traderNonceKey(trader: string, nonce: bigint): string {
  return `${trader.toLowerCase()}:${nonce.toString()}`;
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function normalizeSqlitePath(path: string): string {
  if (path === ":memory:") return path;
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function ensureParentDir(path: string): void {
  if (path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.query(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`alter table ${table} add column ${column} ${definition}`);
}

function sameSign(a: bigint, b: bigint): boolean {
  return (a > 0n && b > 0n) || (a < 0n && b < 0n);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function _bindingsUnused(_bindings: SQLQueryBindings): void {
  // Keeps bun:sqlite binding types visible to package consumers.
}
