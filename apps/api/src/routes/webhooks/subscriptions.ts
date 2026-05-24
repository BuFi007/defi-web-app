/**
 * Webhook subscription management routes (Wave H2).
 *
 * Endpoints (mounted under /webhooks):
 *
 *   POST   /subscriptions             register a new URL + filter
 *   GET    /subscriptions             list integrator's subscriptions
 *   GET    /subscriptions/:id         fetch a single subscription
 *   DELETE /subscriptions/:id         revoke
 *   POST   /subscriptions/:id/rotate-secret  rotate HMAC secret
 *   POST   /subscriptions/:id/test    fire a synthetic test event
 *
 * Auth: every route requires `X-Bufi-Api-Key`. The auth helper derives the
 * integrator id; subscriptions are scoped — an integrator cannot see/touch
 * another integrator's rows.
 */

import { Hono } from "hono";
import { z } from "zod";

import {
  cacheRawSecret,
  evictRawSecret,
  generateWebhookSecret,
  hashSecret,
  WEBHOOK_EVENT_TYPES,
  type DeliveryWorkerHandle,
  type StoredWebhookSubscription,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookStore,
} from "@bufi/webhooks";

import { authenticateIntegrator } from "./auth";

const filterSchema = z.object({
  events: z
    .array(
      z.enum(
        WEBHOOK_EVENT_TYPES as unknown as [WebhookEventType, ...WebhookEventType[]],
      ),
    )
    .min(1),
  markets: z.array(z.string().min(1).max(128)).optional(),
  minNotionalUsdc: z
    .string()
    .regex(/^\d+$/)
    .optional(),
});

const createBodySchema = z.object({
  url: z.string().url(),
  filter: filterSchema,
});

const testBodySchema = z.object({
  /** Optional override of the test event. Defaults to a fill on a sentinel market. */
  event: z
    .object({
      type: z.enum(
        WEBHOOK_EVENT_TYPES as unknown as [WebhookEventType, ...WebhookEventType[]],
      ),
      marketId: z.string().optional(),
    })
    .partial()
    .optional(),
});

export interface WebhookRoutesDeps {
  store: WebhookStore;
  /** May be `null` if the server boots without REDIS_URL + no worker — test routes still work. */
  worker: DeliveryWorkerHandle | null;
  /** Override pepper (tests). Defaults to env. */
  pepper?: string;
}

export function createWebhookRoutes(deps: WebhookRoutesDeps) {
  const app = new Hono();
  const { store, worker, pepper } = deps;

  app.use("*", async (c, next) => {
    const id = authenticateIntegrator(c);
    if (!id) return c.json({ error: "missing or invalid X-Bufi-Api-Key" }, 401);
    c.set("integratorId", id.integratorId);
    await next();
  });

  // POST /subscriptions — register a new URL + filter. Returns the
  // one-time secret in the response; subsequent reads only see metadata.
  app.post("/subscriptions", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    const integratorId = c.get("integratorId") as string;
    const id = `whk_${randomId()}`;
    const secret = generateWebhookSecret();
    const now = Date.now();
    const sub: StoredWebhookSubscription = {
      id,
      integratorId,
      url: parsed.data.url,
      secretHash: hashSecret(secret, pepper),
      filter: {
        events: parsed.data.filter.events,
        ...(parsed.data.filter.markets ? { markets: parsed.data.filter.markets } : {}),
        ...(parsed.data.filter.minNotionalUsdc
          ? { minNotionalUsdc: parsed.data.filter.minNotionalUsdc }
          : {}),
      },
      status: "active",
      createdAt: now,
      updatedAt: now,
      failureCount: 0,
    };
    await store.subscriptions.create(sub);
    cacheRawSecret(id, secret);
    worker?.registerSubscription(sub);
    return c.json({
      id,
      url: sub.url,
      filter: sub.filter,
      status: sub.status,
      createdAt: sub.createdAt,
      // One-time-shown HMAC secret — store the value, you can't retrieve it again.
      secret,
    });
  });

  // GET /subscriptions — list this integrator's subscriptions (metadata only).
  app.get("/subscriptions", async (c) => {
    const integratorId = c.get("integratorId") as string;
    const subs = await store.subscriptions.listByIntegrator(integratorId);
    return c.json({
      subscriptions: subs.map(toPublicSubscription),
    });
  });

  // GET /subscriptions/:id — fetch one.
  app.get("/subscriptions/:id", async (c) => {
    const integratorId = c.get("integratorId") as string;
    const id = c.req.param("id");
    const sub = await store.subscriptions.get(id);
    if (!sub || sub.integratorId !== integratorId) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(toPublicSubscription(sub));
  });

  // DELETE /subscriptions/:id — revoke.
  app.delete("/subscriptions/:id", async (c) => {
    const integratorId = c.get("integratorId") as string;
    const id = c.req.param("id");
    const sub = await store.subscriptions.get(id);
    if (!sub || sub.integratorId !== integratorId) {
      return c.json({ error: "not found" }, 404);
    }
    await store.subscriptions.delete(id);
    evictRawSecret(id);
    worker?.unregisterSubscription(id);
    return c.json({ ok: true });
  });

  // POST /subscriptions/:id/rotate-secret — replace the HMAC secret. Old
  // signatures fail immediately after rotation (no grace window — the
  // integrator must update their receiver). Returns the new secret once.
  app.post("/subscriptions/:id/rotate-secret", async (c) => {
    const integratorId = c.get("integratorId") as string;
    const id = c.req.param("id");
    const sub = await store.subscriptions.get(id);
    if (!sub || sub.integratorId !== integratorId) {
      return c.json({ error: "not found" }, 404);
    }
    const secret = generateWebhookSecret();
    const updatedAt = Date.now();
    await store.subscriptions.updateSecretHash(id, hashSecret(secret, pepper), updatedAt);
    cacheRawSecret(id, secret);
    return c.json({ id, secret, rotatedAt: updatedAt });
  });

  // POST /subscriptions/:id/test — fire a synthetic event at the registered URL.
  // Useful for integrators to verify their endpoint accepts our signed POST.
  app.post("/subscriptions/:id/test", async (c) => {
    if (!worker) {
      return c.json(
        { error: "delivery worker not booted (REDIS_URL absent + worker disabled)" },
        503,
      );
    }
    const integratorId = c.get("integratorId") as string;
    const id = c.req.param("id");
    const sub = await store.subscriptions.get(id);
    if (!sub || sub.integratorId !== integratorId) {
      return c.json({ error: "not found" }, 404);
    }
    const raw = await c.req.json().catch(() => ({}));
    const parsed = testBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    const eventType = (parsed.data.event?.type ?? sub.filter.events[0] ?? "fill") as WebhookEventType;
    const marketId =
      parsed.data.event?.marketId ?? sub.filter.markets?.[0] ?? "0xtestmarket";

    const event = buildSyntheticEvent(eventType, marketId);
    try {
      const result = await worker.enqueueSyntheticTest(id, event);
      return c.json({
        attemptId: result.attemptId,
        delivered: result.ok,
        statusCode: result.statusCode ?? null,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return app;
}

function toPublicSubscription(sub: StoredWebhookSubscription) {
  return {
    id: sub.id,
    url: sub.url,
    filter: sub.filter,
    status: sub.status,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    failureCount: sub.failureCount,
    lastAttemptAt: sub.lastAttemptAt ?? null,
    lastSuccessAt: sub.lastSuccessAt ?? null,
    disabledReason: sub.disabledReason ?? null,
  };
}

function buildSyntheticEvent(
  type: WebhookEventType,
  marketId: string,
): WebhookEvent {
  const market = (marketId.startsWith("0x") ? marketId : `0x${marketId}`) as `0x${string}`;
  const now = Date.now();
  switch (type) {
    case "fill":
      return {
        type: "fill",
        chainId: 5042002,
        marketId: market,
        maker: "0x1111111111111111111111111111111111111111",
        taker: "0x2222222222222222222222222222222222222222",
        priceE18: "1000000000000000000",
        sizeE18: "1000000000000000000",
        txHash: `0x${"f".repeat(64)}`,
        blockNumber: 0,
        ts: now,
      };
    case "liquidation":
      return {
        type: "liquidation",
        chainId: 5042002,
        marketId: market,
        trader: "0x3333333333333333333333333333333333333333",
        liquidator: "0x4444444444444444444444444444444444444444",
        rewardAtomic: "0",
        socializedLossAtomic: "0",
        txHash: `0x${"f".repeat(64)}`,
        blockNumber: 0,
        ts: now,
      };
    case "funding":
      return {
        type: "funding",
        chainId: 5042002,
        marketId: market,
        rateE18: "0",
        markE18: "1000000000000000000",
        cumulativeFundingE18: "0",
        version: 0,
        ts: now,
      };
  }
}

function randomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(12).toString("hex");
}
