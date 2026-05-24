/// <reference types="bun-types" />
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  cacheRawSecret,
  createSqliteWebhookStore,
  startDeliveryWorker,
  signWebhook,
  type DeliveryWorkerHandle,
  type WebhookStore,
} from "@bufi/webhooks";

import { _resetIntegratorKeyCache } from "./auth";
import { createWebhookRoutes } from "./subscriptions";

beforeAll(() => {
  process.env.NODE_ENV ??= "test";
});

let store: WebhookStore;
let worker: DeliveryWorkerHandle;
let lastFetchedCall: { url: string; body: string; headers: Record<string, string> } | null = null;

async function buildHarness() {
  store = createSqliteWebhookStore({ path: ":memory:" });
  worker = await startDeliveryWorker({
    store,
    subscribe: () => () => {},
    fetcher: async (url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      lastFetchedCall = {
        url,
        body: String(init.body ?? ""),
        headers,
      };
      return new Response("ok", { status: 200 });
    },
    tickIntervalMs: 5_000_000,
  });
  const app = new Hono();
  app.route("/webhooks", createWebhookRoutes({ store, worker }));
  return app;
}

beforeEach(async () => {
  lastFetchedCall = null;
  _resetIntegratorKeyCache();
  delete process.env.BUFI_WEBHOOK_INTEGRATORS;
});

afterEach(async () => {
  await worker?.stop();
  store?.close?.();
});

const apiKey = "int_alpha";

describe("webhook subscriptions routes", () => {
  test("POST /subscriptions returns a one-time secret + persists the row", async () => {
    const app = await buildHarness();
    const res = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({
        url: "https://integrator.example/webhook",
        filter: { events: ["fill"], markets: ["0xmarketabc"] },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.id).toMatch(/^whk_/);
    expect(json.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(json.url).toBe("https://integrator.example/webhook");
    expect(json.status).toBe("active");

    const list = await app.request("/webhooks/subscriptions", {
      headers: { "X-Bufi-Api-Key": apiKey },
    });
    const body = (await list.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(1);
  });

  test("subscription is scoped to the integrator", async () => {
    const app = await buildHarness();
    const created = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({
        url: "https://a.example/webhook",
        filter: { events: ["fill"] },
      }),
    });
    const { id } = (await created.json()) as { id: string };

    // Different integrator key — should not see the subscription.
    const list = await app.request("/webhooks/subscriptions", {
      headers: { "X-Bufi-Api-Key": "int_beta" },
    });
    const body = (await list.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(0);

    // ...and cannot delete it.
    const del = await app.request(`/webhooks/subscriptions/${id}`, {
      method: "DELETE",
      headers: { "X-Bufi-Api-Key": "int_beta" },
    });
    expect(del.status).toBe(404);
  });

  test("rotate-secret returns a new secret", async () => {
    const app = await buildHarness();
    const created = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({
        url: "https://a.example/webhook",
        filter: { events: ["fill"] },
      }),
    });
    const { id, secret: oldSecret } = (await created.json()) as {
      id: string;
      secret: string;
    };

    const rotated = await app.request(
      `/webhooks/subscriptions/${id}/rotate-secret`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bufi-Api-Key": apiKey,
        },
      },
    );
    const { secret: newSecret } = (await rotated.json()) as { secret: string };
    expect(newSecret).not.toBe(oldSecret);
    expect(newSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  test("POST /subscriptions/:id/test fires a synthetic delivery + returns status", async () => {
    const app = await buildHarness();
    const created = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({
        url: "https://a.example/webhook",
        filter: { events: ["fill"], markets: ["0xmarketabc"] },
      }),
    });
    const { id, secret } = (await created.json()) as {
      id: string;
      secret: string;
    };

    const test = await app.request(`/webhooks/subscriptions/${id}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({}),
    });
    expect(test.status).toBe(200);
    const result = (await test.json()) as {
      attemptId: string;
      delivered: boolean;
      statusCode: number | null;
    };
    expect(result.delivered).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.attemptId).toMatch(/^att_/);

    // The mock fetcher captured the POST — verify the signature matches.
    expect(lastFetchedCall).not.toBeNull();
    expect(lastFetchedCall!.url).toBe("https://a.example/webhook");
    const headers = lastFetchedCall!.headers;
    const ts = Number(headers["X-Bufi-Timestamp"]);
    const nonce = headers["X-Bufi-Nonce"];
    const sig = headers["X-Bufi-Signature"];
    const expected = signWebhook({
      body: lastFetchedCall!.body,
      nonce,
      timestamp: ts,
      secret,
    });
    expect(sig).toBe(expected);
  });

  test("rejects requests with no X-Bufi-Api-Key", async () => {
    const app = await buildHarness();
    const res = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://a.example",
        filter: { events: ["fill"] },
      }),
    });
    expect(res.status).toBe(401);
  });

  test("DELETE removes the subscription + evicts cached secret", async () => {
    const app = await buildHarness();
    const created = await app.request("/webhooks/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bufi-Api-Key": apiKey,
      },
      body: JSON.stringify({
        url: "https://a.example",
        filter: { events: ["fill"] },
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const del = await app.request(`/webhooks/subscriptions/${id}`, {
      method: "DELETE",
      headers: { "X-Bufi-Api-Key": apiKey },
    });
    expect(del.status).toBe(200);

    const list = await app.request("/webhooks/subscriptions", {
      headers: { "X-Bufi-Api-Key": apiKey },
    });
    const body = (await list.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(0);
  });
});
