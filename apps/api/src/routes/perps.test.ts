/// <reference types="bun-types" />
/**
 * Integration tests for the perps Hono router (Bucket #28).
 *
 * The router is composed with a parent Hono app so we can mount the
 * `log` middleware + a stubbed walletSession the same way `server.ts`
 * does. We rely on the live `perpsService` wired in `services.ts`,
 * which uses an in-memory intent store by default — perfect for tests.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { WalletSession } from "@bufi/shared-types";

import { perpsRoutes } from "./perps";

beforeAll(() => {
  process.env.NODE_ENV ??= "test";
});

interface HarnessOptions {
  session?: WalletSession | null;
}

function harness({ session = null }: HarnessOptions = {}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("log", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => c.var.log,
    } as unknown as never);
    c.set("walletSession", session);
    await next();
  });
  app.route("/", perpsRoutes);
  return app;
}

const TRADER = "0x000000000000000000000000000000000000C0DE";

function sessionFor(address: string): WalletSession {
  return {
    address: address as `0x${string}`,
    chainId: 5042002,
    proof: {
      message: "dev",
      signature: "0x00" as `0x${string}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

describe("perps routes", () => {
  test("GET /markets returns a { markets: [] } envelope", async () => {
    const app = harness();
    const res = await app.request("/markets?chainId=5042002");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markets: unknown[] };
    expect(Array.isArray(body.markets)).toBe(true);
    // Markets may be empty in CI (contracts manifest may not include perps)
    // — we only assert the envelope shape here.
    for (const market of body.markets as Array<Record<string, unknown>>) {
      expect(market).toHaveProperty("marketId");
      expect(market).toHaveProperty("chainId");
      expect(market).toHaveProperty("symbol");
    }
  });

  test("GET /markets defaults chainId to Arc Testnet when omitted", async () => {
    const app = harness();
    const res = await app.request("/markets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markets: unknown[] };
    expect(Array.isArray(body.markets)).toBe(true);
  });

  test("GET /positions/:address without a wallet session returns 401", async () => {
    const app = harness();
    const res = await app.request(`/positions/${TRADER}`);
    expect(res.status).toBe(401);
  });

  test("GET /positions/:address with a matching session returns an array", async () => {
    const app = harness({ session: sessionFor(TRADER) });
    const res = await app.request(`/positions/${TRADER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { address: string; positions: unknown[] };
    expect(body.address.toLowerCase()).toBe(TRADER.toLowerCase());
    expect(Array.isArray(body.positions)).toBe(true);
  });

  test("GET /trades/:address returns an array (empty when no indexer)", async () => {
    const app = harness();
    const res = await app.request(`/trades/${TRADER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { address: string; trades: unknown[] };
    expect(body.address.toLowerCase()).toBe(TRADER.toLowerCase());
    expect(Array.isArray(body.trades)).toBe(true);
    for (const trade of body.trades as Array<Record<string, unknown>>) {
      expect(trade).toHaveProperty("marketId");
      expect(trade).toHaveProperty("side");
      expect(trade).toHaveProperty("sizeUsdc");
      expect(trade).toHaveProperty("priceE18");
    }
  });

  test("POST /intents without a session returns 401", async () => {
    const app = harness();
    const res = await app.request("/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test("POST /intents with a malformed body returns 400", async () => {
    const app = harness({ session: sessionFor(TRADER) });
    const res = await app.request("/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ totally: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown };
    expect(body.error).toBe("bad body");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  test("POST /intents with trader != session.address returns 403", async () => {
    const app = harness({ session: sessionFor(TRADER) });
    const validShape = {
      chainId: 5042002,
      marketId: `0x${"11".repeat(32)}`,
      // Trader intentionally different from session to trip the 403 guard.
      trader: "0x000000000000000000000000000000000000DEAD",
      side: "long",
      sizeUsdc: "1.000000",
      sizeDelta: "1000",
      leverage: 5,
      orderType: "limit",
      priceE18: "1000000000000000000",
      reduceOnly: false,
      postOnly: true,
      nonce: "1",
      deadline: Math.floor(Date.now() / 1000) + 3600,
      signature: `0x${"22".repeat(65)}`,
    };
    const res = await app.request("/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validShape),
    });
    expect(res.status).toBe(403);
  });

  test("GET /intents/:id returns 404 for an unknown id", async () => {
    const app = harness();
    const res = await app.request(`/intents/0x${"de".repeat(32)}`);
    expect(res.status).toBe(404);
  });

  test("GET /funding returns a { funding: [] } envelope", async () => {
    const app = harness();
    const res = await app.request("/funding?chainId=5042002");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { funding: unknown[] };
    expect(Array.isArray(body.funding)).toBe(true);
  });
});
