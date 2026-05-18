/// <reference types="bun-types" />
/**
 * Integration tests for the fx-telarana Hono router (Bucket #28).
 *
 * The router driven here is the live one — it reads markets from the
 * `@bufi/contracts/telarana` deployment manifests via `listMarkets()`,
 * which gracefully falls back to the static market list when the hub RPC
 * is unreachable (the CI environment). Routes that mutate (intents)
 * use the package's in-memory store so we don't need a DB.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { TELARANA_DEPLOYMENTS } from "@bufi/contracts/telarana";
import type { WalletSession } from "@bufi/shared-types";

import { fxTelaranaRoutes } from "./fx-telarana";

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
  app.route("/", fxTelaranaRoutes);
  return app;
}

// Lowercase form passes viem's strict-checksum `isAddress` — the
// fx-telarana `addressSchema` then normalizes via `getAddress`.
const ACCOUNT = "0x000000000000000000000000000000000000face";

function sessionFor(address: string): WalletSession {
  return {
    address: address as `0x${string}`,
    chainId: 43113,
    proof: {
      message: "dev",
      signature: "0x00" as `0x${string}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

const FUJI = TELARANA_DEPLOYMENTS[43113];
const ARC = TELARANA_DEPLOYMENTS[5042002];
const FUJI_M2 = FUJI.markets.find((m) => m.key === "M2_USDC_EURC")!;

describe("fx-telarana routes", () => {
  test("GET /markets returns markets from both hubs (Fuji + Arc fallback)", async () => {
    const app = harness();
    const res = await app.request("/markets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markets: Array<{ hubChainId: number; id: string }> };
    expect(Array.isArray(body.markets)).toBe(true);
    // Static fallback always exposes ≥1 market per hub even when RPC is down.
    const fujiCount = body.markets.filter((m) => m.hubChainId === 43113).length;
    const arcCount = body.markets.filter((m) => m.hubChainId === 5042002).length;
    expect(fujiCount).toBeGreaterThanOrEqual(1);
    expect(arcCount).toBeGreaterThanOrEqual(1);
  });

  test("GET /markets/:hubChainId/:marketId returns 404 for an unknown id", async () => {
    const app = harness();
    const res = await app.request(`/markets/43113/0x${"de".repeat(32)}`);
    expect(res.status).toBe(404);
  });

  test("POST /supply/quote with a malformed body returns 400 + zod error message", async () => {
    const app = harness();
    const res = await app.request("/supply/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ totally: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  test("POST /supply/quote with a valid body returns 200 + supplyShares (or 424/500 if RPC unreachable)", async () => {
    const app = harness();
    const res = await app.request("/supply/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hubChainId: 43113,
        loanToken: FUJI_M2.loanToken,
        collateralToken: FUJI_M2.collateralToken,
        assets: "1000000",
      }),
    });
    // CI may not reach the Fuji RPC; either the quote succeeds (200) or the
    // route surfaces an upstream RPC error. We assert: never a 400 / 401 /
    // 403 / 404, and when 200 the body matches the expected envelope.
    expect([200, 424, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { marketId: string; supplyShares: string; assets: string };
      expect(typeof body.marketId).toBe("string");
      expect(body.supplyShares).toBeDefined();
      expect(body.assets).toBe("1000000");
    }
  });

  test("GET /intents/nonce/:hub/:action/:address returns a numeric string nonce", async () => {
    const app = harness();
    const res = await app.request(`/intents/nonce/43113/Supply/${ACCOUNT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nextNonce: string; account: string; action: string };
    expect(body.action).toBe("Supply");
    expect(body.account.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(/^\d+$/.test(String(body.nextNonce))).toBe(true);
  });

  test("POST /supply/intents without a session returns 401", async () => {
    const app = harness();
    const res = await app.request("/supply/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test("POST /supply/intents with a valid body returns 201 + status='unsigned'", async () => {
    const app = harness({ session: sessionFor(ACCOUNT) });
    const res = await app.request("/supply/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hubChainId: 43113,
        loanToken: FUJI_M2.loanToken,
        collateralToken: FUJI_M2.collateralToken,
        spokeChainId: 43113,
        onBehalf: ACCOUNT,
        nonce: "1",
        deadline: Math.floor(Date.now() / 1000) + 3600,
        assets: "1000000",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; kind: string };
    expect(body.id).toBeDefined();
    expect(body.status).toBe("unsigned");
    expect(body.kind).toBe("Supply");
  });

  test("POST /supply/intents with onBehalf != session returns 403", async () => {
    const app = harness({ session: sessionFor(ACCOUNT) });
    const res = await app.request("/supply/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hubChainId: 43113,
        loanToken: FUJI_M2.loanToken,
        collateralToken: FUJI_M2.collateralToken,
        spokeChainId: 43113,
        onBehalf: "0x000000000000000000000000000000000000dead",
        nonce: "2",
        deadline: Math.floor(Date.now() / 1000) + 3600,
        assets: "1000000",
      }),
    });
    expect(res.status).toBe(403);
  });

  test("GET /tvl returns TVL + borrowed balance maps", async () => {
    const app = harness();
    const res = await app.request("/tvl");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tvl: Record<string, string>;
      borrowed: Record<string, string>;
    };
    // The aggregator returns a map of loanToken → string-encoded BigInt
    // (atomic units), summed across all markets. With no live state the
    // values are all "0" — we only verify shape and presence.
    expect(typeof body.tvl).toBe("object");
    expect(typeof body.borrowed).toBe("object");
    for (const value of Object.values(body.tvl)) {
      expect(/^\d+$/.test(value)).toBe(true);
    }
  });

  test("GET /liquidations/candidates returns empty list when indexer is unconfigured", async () => {
    const app = harness();
    const res = await app.request("/liquidations/candidates?hubChainId=43113");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; candidates: unknown[] };
    expect(body.source).toBe("indexer_unconfigured");
    expect(Array.isArray(body.candidates)).toBe(true);
  });
});
