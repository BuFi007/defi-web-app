/**
 * Webhook surface mount + boot helpers for apps/api.
 *
 * `mountWebhookRoutes(app, { store, worker })` attaches all
 * subscription-management routes under `/webhooks`. The delivery worker is
 * booted separately (it subscribes to Redis channels), and we hand the
 * mount its handle so synthetic-test deliveries can fire end-to-end.
 *
 * Without `REDIS_URL` the worker still boots but no Redis subscription is
 * active — the in-process EventEmitter fallback fans out to channel
 * subscribers that are in the same process. For the API process that means
 * fills published via `/internal/realtime/publish` fan out to webhook
 * subscribers seamlessly.
 */

import type { Hono } from "hono";

import {
  createSqliteWebhookStore,
  startDeliveryWorker,
  type DeliveryWorkerHandle,
  type WebhookStore,
  type SubscribeFn,
} from "@bufi/webhooks";
import { createLogger } from "@bufi/logger";
import { sqlitePathFromEnv } from "@bufi/db";

import { subscribeChannel } from "../../lib/redis";
import { createWebhookRoutes } from "./subscriptions";

declare module "hono" {
  interface ContextVariableMap {
    integratorId?: string;
  }
}

export interface MountWebhookRoutesOptions {
  store: WebhookStore;
  worker: DeliveryWorkerHandle | null;
}

export function mountWebhookRoutes(
  app: Hono,
  opts: MountWebhookRoutesOptions,
): void {
  app.route("/webhooks", createWebhookRoutes(opts));
}

export interface BootWebhookSurfaceOptions {
  /** Override the SQLite path; defaults to BUFI_DB_PATH-derived. */
  storePath?: string;
  /** Disable the delivery worker (e.g. for headless test runs). */
  disableWorker?: boolean;
}

/**
 * Boot the storage + delivery worker. Idempotent — repeated calls return the
 * same handles. Apps/api calls this once on server.ts module load.
 */
export async function bootWebhookSurface(
  opts: BootWebhookSurfaceOptions = {},
): Promise<{ store: WebhookStore; worker: DeliveryWorkerHandle | null }> {
  const log = createLogger({ prefix: "bufi-webhooks-api" });
  const storePath = opts.storePath ?? sqlitePathFromEnv();
  const store = createSqliteWebhookStore({ path: storePath });

  if (opts.disableWorker) {
    log.info("webhook.surface.worker_disabled");
    return { store, worker: null };
  }

  const subscribe: SubscribeFn = (channel, onMessage) =>
    subscribeChannel(channel, onMessage);

  const worker = await startDeliveryWorker({
    store,
    subscribe,
    log,
  });
  log.info("webhook.surface.boot", { storePath });
  return { store, worker };
}

export { createWebhookRoutes } from "./subscriptions";
