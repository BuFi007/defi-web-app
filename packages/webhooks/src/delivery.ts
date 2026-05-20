/**
 * Webhook delivery worker.
 *
 * Subscribes to the Redis channels exposed by PR #56
 * (`trades:<marketId>`, `book:<marketId>`, `funding:<marketId>`) via a
 * caller-provided `SubscribeFn` (so the worker stays decoupled from the
 * concrete redis client — apps/api passes in `subscribeChannel` from
 * `apps/api/src/lib/redis.ts`).
 *
 * Lifecycle:
 *   1. boot(): load all active subscriptions, subscribe to the union of
 *      their per-event channels, start the retry tick.
 *   2. on message: build a `WebhookEvent`, apply each subscription's filter,
 *      and enqueue a delivery attempt for every matching subscription.
 *   3. retry tick: every N seconds, scan `webhook_delivery_attempts` for
 *      rows with `status = scheduled` and `scheduled_for <= now`, fire
 *      them, update status + reschedule on failure per the retry policy.
 *
 * Without `REDIS_URL` the apps/api side falls back to an in-process
 * EventEmitter (PR #56 behaviour); the SubscribeFn semantics are identical
 * either way, so the worker keeps fanning out fine in dev.
 */

import type { Logger } from "@bufi/logger";

import { hashSecret, signWebhook } from "./hmac";
import { nonceForEvent } from "./nonce";
import { decideNextAttempt, initialAttempt } from "./retry";
import type { WebhookStore } from "./storage";
import {
  MAX_DELIVERY_ATTEMPTS,
  WEBHOOK_HEADER_ATTEMPT,
  WEBHOOK_HEADER_EVENT_TYPE,
  WEBHOOK_HEADER_NONCE,
  WEBHOOK_HEADER_SIGNATURE,
  WEBHOOK_HEADER_TIMESTAMP,
  type DeliveryAttempt,
  type StoredWebhookSubscription,
  type WebhookEvent,
  type WebhookEventType,
} from "./types";

/** Channels we subscribe to from PR #56. */
const EVENT_CHANNEL_KIND: Record<WebhookEventType, "trades" | "funding"> = {
  fill: "trades",
  liquidation: "trades", // liquidations ride the trades channel for now
  funding: "funding",
};

/**
 * Caller-supplied subscribe primitive. Identical signature to
 * `apps/api/src/lib/redis.ts#subscribeChannel`. Returns an unsubscribe fn.
 */
export type SubscribeFn = (
  channel: string,
  onMessage: (payload: unknown) => void,
) => () => void;

export interface DeliveryFetcher {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface DeliveryWorkerOptions {
  store: WebhookStore;
  subscribe: SubscribeFn;
  /** Override fetch for tests. */
  fetcher?: DeliveryFetcher;
  /** Override logger; defaults to console-bound `createLogger`. */
  log?: Logger;
  /** How often to scan for due retries. Default 30s. */
  tickIntervalMs?: number;
  /** Optional HMAC pepper override. */
  pepper?: string;
  /** Channel-prefix bridge: maps event type to Redis channel. Tests can stub. */
  channelForMarket?: (kind: "trades" | "funding", marketId: string) => string;
  /** Per-event-type translator: convert raw Redis envelope to WebhookEvent. */
  envelopeAdapter?: EnvelopeAdapter;
  /** Now-source for deterministic tests. */
  nowMs?: () => number;
}

/**
 * Adapter that converts the Redis envelope (TradeMessage/FundingMessage) into
 * the public `WebhookEvent` shape. The realtime layer doesn't currently
 * carry chainId / blockNumber / addresses, so this is where future producers
 * inject those fields (e.g. by including them in `data` alongside the
 * existing TradeMessage shape).
 *
 * Today's behaviour: we accept envelopes whose `data` already includes the
 * extra fields and fall back to defaults (`chainId: 0`, zero-address) when
 * missing. This is forward-compatible with PR #56 — producers can extend the
 * payload without changing the channel envelope schema.
 */
export interface EnvelopeAdapter {
  fillFromTrade(payload: unknown): WebhookEvent | null;
  liquidationFromTrade(payload: unknown): WebhookEvent | null;
  fundingFromFunding(payload: unknown): WebhookEvent | null;
}

const defaultEnvelopeAdapter: EnvelopeAdapter = {
  fillFromTrade(payload) {
    const env = asEnvelope(payload);
    if (!env || env.kind !== "trades") return null;
    const data = env.data as Record<string, unknown>;
    // Only treat a trades-channel envelope as a "fill" if it explicitly
    // declares `kind: "fill"` (or omits kind — backward compatible).
    if (data.kind && data.kind !== "fill") return null;
    return {
      type: "fill",
      chainId: Number(data.chainId ?? 0),
      marketId: (env.marketId as `0x${string}`) ?? "0x",
      maker: (data.maker as `0x${string}`) ?? zeroAddress(),
      taker: (data.taker as `0x${string}`) ?? zeroAddress(),
      priceE18: String(data.priceE18 ?? "0"),
      sizeE18: String(data.sizeE18 ?? "0"),
      txHash: (data.txHash as `0x${string}`) ?? zeroTxHash(),
      blockNumber: Number(data.blockNumber ?? 0),
      ts: Number(data.ts ?? Date.now()),
    };
  },
  liquidationFromTrade(payload) {
    const env = asEnvelope(payload);
    if (!env || env.kind !== "trades") return null;
    const data = env.data as Record<string, unknown>;
    if (data.kind !== "liquidation") return null;
    return {
      type: "liquidation",
      chainId: Number(data.chainId ?? 0),
      marketId: (env.marketId as `0x${string}`) ?? "0x",
      trader: (data.trader as `0x${string}`) ?? zeroAddress(),
      liquidator: (data.liquidator as `0x${string}`) ?? zeroAddress(),
      rewardAtomic: String(data.rewardAtomic ?? "0"),
      socializedLossAtomic: String(data.socializedLossAtomic ?? "0"),
      txHash: (data.txHash as `0x${string}`) ?? zeroTxHash(),
      blockNumber: Number(data.blockNumber ?? 0),
      ts: Number(data.ts ?? Date.now()),
    };
  },
  fundingFromFunding(payload) {
    const env = asEnvelope(payload);
    if (!env || env.kind !== "funding") return null;
    const data = env.data as Record<string, unknown>;
    return {
      type: "funding",
      chainId: Number(data.chainId ?? 0),
      marketId: (env.marketId as `0x${string}`) ?? "0x",
      rateE18: String(data.rateE18 ?? "0"),
      markE18: String(data.markE18 ?? "0"),
      cumulativeFundingE18: String(data.cumulativeFundingE18 ?? "0"),
      version: Number(data.version ?? 0),
      ts: Number(data.ts ?? Date.now()),
    };
  },
};

export interface DeliveryWorkerHandle {
  /** Returns the worker's known subscription cache. */
  subscriptions(): StoredWebhookSubscription[];
  /** Manually trigger a single retry pass (e.g. in tests). */
  tick(): Promise<void>;
  /** Manually deliver an attempt synchronously. */
  deliver(attempt: DeliveryAttempt): Promise<{ ok: boolean; statusCode?: number }>;
  /** Subscribe to a fresh subscription added at runtime. */
  registerSubscription(sub: StoredWebhookSubscription): void;
  /** Drop a runtime subscription (revoke). */
  unregisterSubscription(id: string): void;
  /** Fire a synthetic event (used by POST /webhooks/subscriptions/:id/test). */
  enqueueSyntheticTest(
    subscriptionId: string,
    event: WebhookEvent,
  ): Promise<{ ok: boolean; statusCode?: number; attemptId: string }>;
  /** Tear down. */
  stop(): Promise<void>;
}

/**
 * Boot the delivery worker. Returns a handle the API server holds onto so it
 * can register new subscriptions at runtime + tear down on shutdown.
 */
export async function startDeliveryWorker(
  opts: DeliveryWorkerOptions,
): Promise<DeliveryWorkerHandle> {
  const log = opts.log ?? buildLog();
  const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
  const adapter = opts.envelopeAdapter ?? defaultEnvelopeAdapter;
  const now = opts.nowMs ?? (() => Date.now());

  const subscriptions = new Map<string, StoredWebhookSubscription>();
  const channelUnsubs = new Map<string, () => void>();
  // We rely on Redis channel SUBSCRIBE being a noop on second call for the
  // same channel — subscribeChannel demuxes per-callback so each subscription
  // gets its own per-channel handler.

  // Load active subscriptions at boot.
  const active = await opts.store.subscriptions.listActive();
  for (const sub of active) {
    subscriptions.set(sub.id, sub);
    attachToChannels(sub);
  }
  log.info("webhook.worker.boot", {
    activeSubscriptions: active.length,
  });

  // Background retry tick.
  const tickIntervalMs = opts.tickIntervalMs ?? 30_000;
  let stopped = false;
  let tickHandle: ReturnType<typeof setTimeout> | null = null;
  const scheduleTick = () => {
    if (stopped) return;
    tickHandle = setTimeout(async () => {
      try {
        await runTick();
      } catch (err) {
        log.warn("webhook.worker.tick_failed", {
          err: (err as Error).message,
        });
      }
      scheduleTick();
    }, tickIntervalMs);
    // Don't keep the event loop alive only for this timer.
    (tickHandle as unknown as { unref?: () => void }).unref?.();
  };
  scheduleTick();

  return {
    subscriptions: () => Array.from(subscriptions.values()),
    tick: () => runTick(),
    deliver: (attempt) => deliverAttempt(attempt),
    registerSubscription(sub) {
      subscriptions.set(sub.id, sub);
      attachToChannels(sub);
    },
    unregisterSubscription(id) {
      subscriptions.delete(id);
      // Channels remain subscribed at the Redis layer if other subs still use
      // them. We leave the demux handlers in place — they'll no-op because
      // the sub is gone from the in-memory cache, and onMessage's lookup
      // check prevents leaks.
    },
    enqueueSyntheticTest,
    async stop() {
      stopped = true;
      if (tickHandle) clearTimeout(tickHandle);
      for (const unsub of channelUnsubs.values()) {
        try {
          unsub();
        } catch {
          /* ignore */
        }
      }
      channelUnsubs.clear();
    },
  };

  // ---------- helpers ----------

  function attachToChannels(sub: StoredWebhookSubscription): void {
    const kinds = new Set<"trades" | "funding">();
    for (const eventType of sub.filter.events) {
      kinds.add(EVENT_CHANNEL_KIND[eventType]);
    }
    const markets = sub.filter.markets?.length ? sub.filter.markets : null;

    // We subscribe per (kind, marketId) tuple. If `markets` is null we'd
    // need a wildcard subscription, which Redis pub/sub doesn't support
    // directly without psubscribe. As a pragmatic fallback when no market
    // filter is given, we subscribe to a `${kind}:*` synthetic channel that
    // the producer is expected to ALSO publish to. PR #56 doesn't currently
    // publish to a wildcard mirror, so deliveries for unfiltered
    // subscriptions only fire once specific markets are added; document
    // this for now and revisit when wildcard support lands.
    if (!markets) {
      // No-op channel attachment — but the message handler still inspects
      // every event since the subscription is in our in-memory cache.
      // (Producer-side wildcard mirroring is tracked separately.)
      return;
    }

    for (const kind of kinds) {
      for (const marketId of markets) {
        const channel = opts.channelForMarket
          ? opts.channelForMarket(kind, marketId)
          : `${kind}:${marketId}`;
        const key = `${sub.id}::${channel}`;
        if (channelUnsubs.has(key)) continue;
        const unsub = opts.subscribe(channel, (payload) =>
          handleChannelMessage(kind, payload),
        );
        channelUnsubs.set(key, unsub);
      }
    }
  }

  function handleChannelMessage(
    kind: "trades" | "funding",
    payload: unknown,
  ): void {
    const events: WebhookEvent[] = [];
    if (kind === "trades") {
      const fill = adapter.fillFromTrade(payload);
      if (fill) events.push(fill);
      const liq = adapter.liquidationFromTrade(payload);
      if (liq) events.push(liq);
    } else {
      const funding = adapter.fundingFromFunding(payload);
      if (funding) events.push(funding);
    }

    for (const event of events) {
      for (const sub of subscriptions.values()) {
        if (sub.status !== "active") continue;
        if (!matchesFilter(sub, event)) continue;
        void enqueueDelivery(sub, event).catch((err) => {
          log.warn("webhook.enqueue.failed", {
            subscriptionId: sub.id,
            err: (err as Error).message,
          });
        });
      }
    }
  }

  async function enqueueDelivery(
    sub: StoredWebhookSubscription,
    event: WebhookEvent,
  ): Promise<void> {
    const nonce = nonceForEvent(event);
    const alreadyDelivered = await opts.store.attempts.hasSucceededNonce(
      sub.id,
      nonce,
    );
    if (alreadyDelivered) {
      log.debug("webhook.dedup", { subscriptionId: sub.id, nonce });
      return;
    }
    const initial = initialAttempt(now());
    const attempt: DeliveryAttempt = {
      id: `att_${randomId()}`,
      subscriptionId: sub.id,
      nonce,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
      attempt: initial.nextAttempt,
      scheduledFor: initial.scheduledFor,
      status: "scheduled",
      createdAt: now(),
      updatedAt: now(),
    };
    await opts.store.attempts.create(attempt);
    // Fire immediately — the retry tick is only for failed redeliveries.
    void deliverAttempt(attempt).catch((err) => {
      log.warn("webhook.deliver.threw", {
        attemptId: attempt.id,
        err: (err as Error).message,
      });
    });
  }

  async function deliverAttempt(
    attempt: DeliveryAttempt,
  ): Promise<{ ok: boolean; statusCode?: number }> {
    const sub = subscriptions.get(attempt.subscriptionId);
    if (!sub) {
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "failed",
        lastError: "subscription_not_found",
        updatedAt: now(),
      });
      return { ok: false };
    }

    await opts.store.attempts.updateAttempt({
      id: attempt.id,
      status: "in_flight",
      updatedAt: now(),
    });

    const body = attempt.payloadJson;
    const timestamp = Math.floor(now() / 1000);
    // We DON'T have the raw secret here (only its hash). The signing path
    // requires the raw secret — so callers (test endpoint, fresh registrations)
    // pass the raw secret through `enqueueSyntheticTest`. For background
    // deliveries we'd normally key-derive from a per-subscription KMS handle;
    // for the SQLite reference implementation we keep an in-memory cache of
    // raw secrets that's populated from create/rotate calls in the same
    // process. The cache is best-effort and survives only as long as the
    // process lives. (Multi-instance deployments will replace this with a
    // shared-secret manager.)
    const rawSecret = rawSecretCache.get(sub.id);
    if (!rawSecret) {
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "failed",
        lastError: "raw_secret_unavailable",
        updatedAt: now(),
      });
      log.warn("webhook.deliver.no_secret", {
        subscriptionId: sub.id,
        attemptId: attempt.id,
      });
      return { ok: false };
    }

    // Sanity-check that the cached raw secret matches the stored hash.
    if (hashSecret(rawSecret, opts.pepper) !== sub.secretHash) {
      log.warn("webhook.deliver.secret_mismatch", { subscriptionId: sub.id });
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "failed",
        lastError: "secret_hash_mismatch",
        updatedAt: now(),
      });
      return { ok: false };
    }

    const signature = signWebhook({
      body,
      nonce: attempt.nonce,
      timestamp,
      secret: rawSecret,
    });

    let response: Response | null = null;
    let transportError: Error | null = null;
    try {
      response = await fetcher(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [WEBHOOK_HEADER_SIGNATURE]: signature,
          [WEBHOOK_HEADER_NONCE]: attempt.nonce,
          [WEBHOOK_HEADER_TIMESTAMP]: String(timestamp),
          [WEBHOOK_HEADER_EVENT_TYPE]: attempt.eventType,
          [WEBHOOK_HEADER_ATTEMPT]: String(attempt.attempt),
        },
        body,
      });
    } catch (err) {
      transportError = err as Error;
    }

    const succeeded =
      response !== null && response.status >= 200 && response.status < 300;
    if (succeeded) {
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "succeeded",
        lastStatusCode: response!.status,
        updatedAt: now(),
      });
      await opts.store.subscriptions.recordDeliveryOutcome({
        id: sub.id,
        success: true,
        attemptAt: now(),
        failureCount: 0,
        updatedAt: now(),
      });
      // Reflect into in-memory cache so the worker sees fresh counters.
      sub.failureCount = 0;
      sub.lastSuccessAt = now();
      sub.lastAttemptAt = now();
      log.info("webhook.deliver.ok", {
        subscriptionId: sub.id,
        attemptId: attempt.id,
        statusCode: response!.status,
      });
      return { ok: true, statusCode: response!.status };
    }

    // Failure path: schedule retry OR dead-letter.
    const lastStatusCode = response?.status;
    const lastError = transportError?.message ?? `non_2xx_status_${lastStatusCode ?? "?"}`;
    const decision = decideNextAttempt({
      attempt: attempt.attempt,
      nowMs: now(),
    });
    if (decision.kind === "retry") {
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "failed",
        lastStatusCode,
        lastError,
        updatedAt: now(),
      });
      const retry: DeliveryAttempt = {
        ...attempt,
        id: `att_${randomId()}`,
        attempt: decision.nextAttempt,
        scheduledFor: decision.scheduledFor,
        status: "scheduled",
        createdAt: now(),
        updatedAt: now(),
        lastStatusCode,
        lastError,
      };
      await opts.store.attempts.create(retry);
    } else {
      // Dead-letter: mark the attempt + flip the subscription off.
      await opts.store.attempts.updateAttempt({
        id: attempt.id,
        status: "dead_lettered",
        lastStatusCode,
        lastError,
        updatedAt: now(),
      });
      await opts.store.subscriptions.updateStatus(
        sub.id,
        "disabled",
        now(),
        `dead_lettered_after_${MAX_DELIVERY_ATTEMPTS}_attempts`,
      );
      subscriptions.delete(sub.id);
      log.error("webhook.deliver.dead_lettered", {
        subscriptionId: sub.id,
        attemptId: attempt.id,
        lastStatusCode,
        lastError,
      });
    }

    const updatedFailureCount = (sub.failureCount ?? 0) + 1;
    await opts.store.subscriptions.recordDeliveryOutcome({
      id: sub.id,
      success: false,
      attemptAt: now(),
      failureCount: updatedFailureCount,
      updatedAt: now(),
    });
    sub.failureCount = updatedFailureCount;
    sub.lastAttemptAt = now();

    return { ok: false, statusCode: lastStatusCode };
  }

  async function enqueueSyntheticTest(
    subscriptionId: string,
    event: WebhookEvent,
  ): Promise<{ ok: boolean; statusCode?: number; attemptId: string }> {
    const sub = subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`subscription ${subscriptionId} not found`);
    }
    // Synthetic tests use a unique nonce per call so they don't trip the
    // dedup filter when integrators fire repeatedly.
    const nonce = `test-${subscriptionId}-${now()}-${randomId()}`;
    const attempt: DeliveryAttempt = {
      id: `att_${randomId()}`,
      subscriptionId,
      nonce,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
      attempt: 1,
      scheduledFor: now(),
      status: "scheduled",
      createdAt: now(),
      updatedAt: now(),
    };
    await opts.store.attempts.create(attempt);
    const result = await deliverAttempt(attempt);
    return { ...result, attemptId: attempt.id };
  }

  async function runTick(): Promise<void> {
    const due = await opts.store.attempts.listScheduledBefore(now(), 100);
    for (const attempt of due) {
      try {
        await deliverAttempt(attempt);
      } catch (err) {
        log.warn("webhook.retry.deliver_failed", {
          attemptId: attempt.id,
          err: (err as Error).message,
        });
      }
    }
  }
}

/**
 * Process-wide cache of raw HMAC secrets. Populated by route handlers when
 * they create/rotate a secret; the delivery worker reads from here. A
 * separate cache (rather than threading the secret through the SubscribeFn)
 * keeps the rotation flow purely additive: a new secret is cached then
 * persisted, old secret is evicted, no in-flight delivery sees a stale key.
 */
export const rawSecretCache = new Map<string, string>();

export function cacheRawSecret(subscriptionId: string, secret: string): void {
  rawSecretCache.set(subscriptionId, secret);
}

export function evictRawSecret(subscriptionId: string): void {
  rawSecretCache.delete(subscriptionId);
}

// ---------- filter matching ----------

export function matchesFilter(
  sub: StoredWebhookSubscription,
  event: WebhookEvent,
): boolean {
  if (!sub.filter.events.includes(event.type)) return false;
  if (sub.filter.markets?.length) {
    const eventMarketLower = event.marketId.toLowerCase();
    const allowed = sub.filter.markets.map((m) => m.toLowerCase());
    if (!allowed.includes(eventMarketLower)) return false;
  }
  if (sub.filter.minNotionalUsdc && event.type === "fill") {
    // Notional = priceE18 * sizeE18 / 1e36 (both fields are 18-decimals,
    // and we want a USDC atomic value -> divide by 1e36 then multiply by
    // 1e6 -> /1e30).
    try {
      const notional = (BigInt(event.priceE18) * BigInt(event.sizeE18)) / 10n ** 30n;
      const floor = BigInt(sub.filter.minNotionalUsdc);
      if (notional < floor) return false;
    } catch {
      // Bad numbers — let the event through rather than silently drop.
    }
  }
  return true;
}

// ---------- internals ----------

function asEnvelope(
  payload: unknown,
): { kind: string; marketId: string; data: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!p.kind || !p.marketId || !p.data) return null;
  return {
    kind: String(p.kind),
    marketId: String(p.marketId),
    data: p.data,
  };
}

function buildLog(): Logger {
  // Light shim if @bufi/logger isn't loaded for some reason.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@bufi/logger") as typeof import("@bufi/logger");
  return mod.createLogger({ prefix: "bufi-webhooks" });
}

function randomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(12).toString("hex");
}

function zeroAddress(): `0x${string}` {
  return `0x${"0".repeat(40)}`;
}

function zeroTxHash(): `0x${string}` {
  return `0x${"0".repeat(64)}`;
}
