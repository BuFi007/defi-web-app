/**
 * Bun:sqlite-backed implementation of the WebhookStore.
 *
 * Migration mirrors the style in `packages/db/src/index.ts` — `create table
 * if not exists` blocks + idempotent `ensureColumn` for schema evolution.
 * Tests use `:memory:` for hermetic isolation; production paths share the
 * same `.bufi/trading-machine.sqlite` (or whatever BUFI_DB_PATH points at).
 */

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { Database } from "bun:sqlite";

import type {
  DeliveryAttempt,
  DeliveryAttemptStatus,
  StoredWebhookSubscription,
  WebhookFilter,
  WebhookSubscriptionStatus,
} from "./types";
import type {
  DeliveryAttemptStore,
  SubscriptionStore,
  WebhookStore,
} from "./storage";

type Row = Record<string, unknown>;

export interface CreateSqliteWebhookStoreOptions {
  path: string;
}

export function createSqliteWebhookStore(
  opts: CreateSqliteWebhookStoreOptions,
): WebhookStore {
  const dbPath = normalizeSqlitePath(opts.path);
  ensureParentDir(dbPath);
  const db = new Database(dbPath, { create: true, strict: true });
  migrate(db);

  return {
    subscriptions: createSubscriptionStore(db),
    attempts: createDeliveryAttemptStore(db),
    close() {
      db.close();
    },
  };
}

function createSubscriptionStore(db: Database): SubscriptionStore {
  const insert = db.query(`
    insert into webhook_subscriptions (
      id, integrator_id, url, secret_hash, filter_json, status,
      created_at, updated_at, failure_count, last_attempt_at,
      last_success_at, disabled_reason
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.query("select * from webhook_subscriptions where id = ?");
  const byIntegrator = db.query(`
    select * from webhook_subscriptions
    where integrator_id = ?
    order by created_at desc, id desc
  `);
  const active = db.query(`
    select * from webhook_subscriptions
    where status = 'active'
    order by created_at asc, id asc
  `);
  const updateSecret = db.query(`
    update webhook_subscriptions
    set secret_hash = ?, updated_at = ?
    where id = ?
  `);
  const updateStatusStmt = db.query(`
    update webhook_subscriptions
    set status = ?, updated_at = ?, disabled_reason = ?
    where id = ?
  `);
  const recordOutcome = db.query(`
    update webhook_subscriptions
    set last_attempt_at = ?, last_success_at = ?, failure_count = ?, updated_at = ?
    where id = ?
  `);
  const removeStmt = db.query("delete from webhook_subscriptions where id = ?");

  return {
    async create(sub) {
      insert.run(
        sub.id,
        sub.integratorId,
        sub.url,
        sub.secretHash,
        JSON.stringify(sub.filter),
        sub.status,
        sub.createdAt,
        sub.updatedAt,
        sub.failureCount,
        sub.lastAttemptAt ?? null,
        sub.lastSuccessAt ?? null,
        sub.disabledReason ?? null,
      );
    },
    async get(id) {
      return rowToSubscription(byId.get(id) as Row | null);
    },
    async listByIntegrator(integratorId) {
      return (byIntegrator.all(integratorId) as Row[])
        .map((row) => rowToSubscription(row)!)
        .filter(Boolean);
    },
    async listActive() {
      return (active.all() as Row[]).map((row) => rowToSubscription(row)!);
    },
    async updateSecretHash(id, secretHash, updatedAt) {
      updateSecret.run(secretHash, updatedAt, id);
    },
    async updateStatus(id, status, updatedAt, reason) {
      updateStatusStmt.run(status, updatedAt, reason ?? null, id);
    },
    async recordDeliveryOutcome({ id, success, attemptAt, failureCount, updatedAt }) {
      const existing = await this.get(id);
      const lastSuccessAt = success ? attemptAt : existing?.lastSuccessAt ?? null;
      recordOutcome.run(
        attemptAt,
        lastSuccessAt,
        failureCount,
        updatedAt,
        id,
      );
    },
    async delete(id) {
      removeStmt.run(id);
    },
  };
}

function createDeliveryAttemptStore(db: Database): DeliveryAttemptStore {
  const insert = db.query(`
    insert into webhook_delivery_attempts (
      id, subscription_id, nonce, event_type, payload_json,
      attempt, scheduled_for, status,
      last_status_code, last_error, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const hasSucceeded = db.query(`
    select 1 from webhook_delivery_attempts
    where subscription_id = ? and nonce = ? and status = 'succeeded'
    limit 1
  `);
  const scheduledBefore = db.query(`
    select * from webhook_delivery_attempts
    where status = 'scheduled' and scheduled_for <= ?
    order by scheduled_for asc, id asc
    limit ?
  `);
  const updateStmt = db.query(`
    update webhook_delivery_attempts
    set status = ?,
        last_status_code = coalesce(?, last_status_code),
        last_error = coalesce(?, last_error),
        scheduled_for = coalesce(?, scheduled_for),
        attempt = coalesce(?, attempt),
        updated_at = ?
    where id = ?
  `);
  const forSub = db.query(`
    select * from webhook_delivery_attempts
    where subscription_id = ?
    order by created_at desc, id desc
    limit ?
  `);

  return {
    async create(attempt) {
      insert.run(
        attempt.id,
        attempt.subscriptionId,
        attempt.nonce,
        attempt.eventType,
        attempt.payloadJson,
        attempt.attempt,
        attempt.scheduledFor,
        attempt.status,
        attempt.lastStatusCode ?? null,
        attempt.lastError ?? null,
        attempt.createdAt,
        attempt.updatedAt,
      );
    },
    async hasSucceededNonce(subscriptionId, nonce) {
      const row = hasSucceeded.get(subscriptionId, nonce) as Row | null;
      return Boolean(row);
    },
    async listScheduledBefore(beforeMs, limit) {
      return (scheduledBefore.all(beforeMs, limit) as Row[]).map(
        (row) => rowToAttempt(row)!,
      );
    },
    async updateAttempt(args) {
      updateStmt.run(
        args.status,
        args.lastStatusCode ?? null,
        args.lastError ?? null,
        args.scheduledFor ?? null,
        args.attempt ?? null,
        args.updatedAt,
        args.id,
      );
    },
    async listForSubscription(subscriptionId, limit = 50) {
      return (forSub.all(subscriptionId, limit) as Row[]).map(
        (row) => rowToAttempt(row)!,
      );
    },
  };
}

function rowToSubscription(row: Row | null): StoredWebhookSubscription | null {
  if (!row) return null;
  const filter = JSON.parse(String(row.filter_json)) as WebhookFilter;
  const sub: StoredWebhookSubscription = {
    id: String(row.id),
    integratorId: String(row.integrator_id),
    url: String(row.url),
    secretHash: String(row.secret_hash),
    filter,
    status: String(row.status) as WebhookSubscriptionStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    failureCount: Number(row.failure_count ?? 0),
  };
  if (row.last_attempt_at !== null && row.last_attempt_at !== undefined) {
    sub.lastAttemptAt = Number(row.last_attempt_at);
  }
  if (row.last_success_at !== null && row.last_success_at !== undefined) {
    sub.lastSuccessAt = Number(row.last_success_at);
  }
  if (row.disabled_reason !== null && row.disabled_reason !== undefined) {
    sub.disabledReason = String(row.disabled_reason);
  }
  return sub;
}

function rowToAttempt(row: Row | null): DeliveryAttempt | null {
  if (!row) return null;
  const attempt: DeliveryAttempt = {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    nonce: String(row.nonce),
    eventType: String(row.event_type) as DeliveryAttempt["eventType"],
    payloadJson: String(row.payload_json),
    attempt: Number(row.attempt),
    scheduledFor: Number(row.scheduled_for),
    status: String(row.status) as DeliveryAttemptStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.last_status_code !== null && row.last_status_code !== undefined) {
    attempt.lastStatusCode = Number(row.last_status_code);
  }
  if (row.last_error !== null && row.last_error !== undefined) {
    attempt.lastError = String(row.last_error);
  }
  return attempt;
}

function migrate(db: Database): void {
  db.exec(`
    pragma journal_mode = WAL;
    pragma foreign_keys = ON;

    create table if not exists webhook_subscriptions (
      id text primary key,
      integrator_id text not null,
      url text not null,
      secret_hash text not null,
      filter_json text not null,
      status text not null default 'active',
      created_at integer not null,
      updated_at integer not null,
      failure_count integer not null default 0,
      last_attempt_at integer,
      last_success_at integer,
      disabled_reason text
    );

    create index if not exists idx_webhook_subscriptions_integrator
      on webhook_subscriptions (integrator_id);
    create index if not exists idx_webhook_subscriptions_status
      on webhook_subscriptions (status);

    create table if not exists webhook_delivery_attempts (
      id text primary key,
      subscription_id text not null,
      nonce text not null,
      event_type text not null,
      payload_json text not null,
      attempt integer not null,
      scheduled_for integer not null,
      status text not null,
      last_status_code integer,
      last_error text,
      created_at integer not null,
      updated_at integer not null
    );

    create index if not exists idx_webhook_attempts_scheduled
      on webhook_delivery_attempts (status, scheduled_for);
    create unique index if not exists idx_webhook_attempts_dedup
      on webhook_delivery_attempts (subscription_id, nonce, attempt);
    create index if not exists idx_webhook_attempts_subscription
      on webhook_delivery_attempts (subscription_id, created_at desc);
  `);
}

function normalizeSqlitePath(path: string): string {
  if (path === ":memory:") return path;
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function ensureParentDir(path: string): void {
  if (path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
}
