import { describe, expect, test } from "bun:test";
import app from "../src/app.ts";

const ADDR = "0xb79e4987bc58057a322cd9bcface4944dd6a6cc7";

function post(path: string, body: unknown) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string) {
  return app.fetch(new Request(`http://localhost${path}`));
}

// Live perp/cost quotes depend on a third-party Pyth feed. When that feed goes
// stale (age > maxStaleSeconds) the endpoint CORRECTLY returns an oracle-stale
// error — that's the contract working, not a bug. Treat it as an acceptable
// outcome so the suite isn't flaky on upstream feed lag; assertions still run
// fully whenever the feed is fresh.
function isStaleOracle(body: unknown): boolean {
  const err = (body as { error?: unknown })?.error;
  return typeof err === "string" && /oracle stale|stale.*max/i.test(err);
}

// ── Health ──

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ts).toBeNumber();
  });
});

// ── Discovery ──

describe("discovery", () => {
  test("GET /mcp returns landing page", async () => {
    const res = await get("/mcp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpoint).toContain("/mcp");
    expect(body.tools).toBeDefined();
  });

  test("GET /llms.txt returns protocol description", async () => {
    const res = await get("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Quick Trade");
    expect(text).toContain("EURC/USDC");
    expect(text).not.toContain("CHF/USDC");
    expect(text).toContain("Up to 50x leverage");
  });
});

// ── Auth ──

describe("auth", () => {
  test("POST /auth/token accepts address field", async () => {
    const res = await post("/auth/token", { address: ADDR, scope: "read trade" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode === "open" || body.token).toBeTruthy();
  });

  test("POST /auth/token rejects invalid address", async () => {
    const res = await post("/auth/token", { address: "not-an-address" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("POST /auth/token rejects old wallet field", async () => {
    const res = await post("/auth/token", { wallet: ADDR });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Markets ──

describe("markets", () => {
  test("GET /api/markets lists the core perp markets", async () => {
    const res = await get("/api/markets");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Count is config-driven and grows as markets are added (e.g. QCAD).
    // Assert the core set is present rather than pinning a brittle exact count.
    expect(body.markets.length).toBeGreaterThanOrEqual(5);
    const symbols = body.markets.map((m: { symbol: string }) => m.symbol);
    expect(symbols).toContain("EURC/USDC");
    expect(symbols).toContain("JPYC/USDC");
    expect(symbols).toContain("MXNB/USDC");
    expect(symbols).toContain("CIRBTC/USDC");
    expect(symbols).toContain("AUDF/USDC");
    expect(symbols).not.toContain("CHF/USDC");
  });

  test("all markets have chainId 5042002", async () => {
    const res = await get("/api/markets");
    const body = await res.json();
    for (const m of body.markets) {
      expect(m.chainId).toBe(5042002);
      expect(m.enabled).toBe(true);
    }
  });
});

// ── Perp Quotes ──

describe("perp quotes", () => {
  const LIVE_MARKETS = ["EURC/USDC", "JPYC/USDC", "MXNB/USDC", "CIRBTC/USDC"];

  for (const symbol of LIVE_MARKETS) {
    test(`${symbol} long quote returns mark price`, async () => {
      const res = await post("/api/quote", { symbol, side: "long", sizeUsdc: "1" });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (isStaleOracle(body)) return; // upstream feed lag — endpoint behaved correctly
      expect(body.markPrice).toBeDefined();
      expect(Number(body.markPrice)).toBeGreaterThan(0);
      expect(body.maxLeverage).toBe(50);
    });

    test(`${symbol} short quote returns mark price`, async () => {
      const res = await post("/api/quote", { symbol, side: "short", sizeUsdc: "10", leverage: 5 });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (isStaleOracle(body)) return;
      expect(Number(body.markPrice)).toBeGreaterThan(0);
    });
  }

  test("rejects invalid symbol", async () => {
    const res = await post("/api/quote", { symbol: "CHF/USDC", side: "long", sizeUsdc: "1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("rejects leverage > 50", async () => {
    const res = await post("/api/quote", { symbol: "EURC/USDC", side: "long", sizeUsdc: "1", leverage: 51 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("50x leverage succeeds", async () => {
    const res = await post("/api/quote", { symbol: "EURC/USDC", side: "long", sizeUsdc: "1", leverage: 50 });
    expect(res.status).toBe(200);
  });
});

// ── Trade Prepare ──

describe("trade prepare", () => {
  const LIVE_MARKETS = ["EURC/USDC", "JPYC/USDC", "MXNB/USDC", "CIRBTC/USDC"];

  for (const symbol of LIVE_MARKETS) {
    test(`${symbol} prepare returns digest + typedData`, async () => {
      const res = await post("/api/trade/prepare", {
        symbol, side: "long", sizeUsdc: "5", leverage: 2, trader: ADDR,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (isStaleOracle(body)) return; // upstream feed lag — endpoint behaved correctly
      expect(body.order.digest).toMatch(/^0x/);
      expect(body.order.typedData.types.EIP712Domain).toBeDefined();
      expect(body.order.typedData.types.SignedOrder).toBeDefined();
      expect(body.order.typedData.domain.chainId).toBe(5042002);
      expect(body.order.deadline).toBeNumber();
      expect(body.order.nonce).toBeDefined();
      expect(body.quote.markPrice).toBeDefined();
    });
  }

  test("rejects missing trader", async () => {
    const res = await post("/api/trade/prepare", {
      symbol: "EURC/USDC", side: "long", sizeUsdc: "5", leverage: 2,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("rejects zero sizeUsdc", async () => {
    const res = await post("/api/trade/prepare", {
      symbol: "EURC/USDC", side: "long", sizeUsdc: "0", leverage: 2, trader: ADDR,
    });
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("rejects negative sizeUsdc", async () => {
    const res = await post("/api/trade/prepare", {
      symbol: "EURC/USDC", side: "long", sizeUsdc: "-5", leverage: 2, trader: ADDR,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Close Prepare ──

describe("close prepare", () => {
  test("EURC/USDC close returns reduceOnly digest", async () => {
    const res = await post("/api/close/prepare", {
      symbol: "EURC/USDC", side: "long", sizeUsdc: "5", trader: ADDR,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.digest).toMatch(/^0x/);
    expect(body.order.reduceOnly).toBe(true);
    expect(body.closing).toBe("long");
  });
});

// ── Cost Estimate ──

describe("cost estimate", () => {
  const LIVE_MARKETS = ["EURC/USDC", "JPYC/USDC", "MXNB/USDC", "CIRBTC/USDC"];

  for (const symbol of LIVE_MARKETS) {
    test(`${symbol} returns total cost`, async () => {
      const res = await post("/api/cost", { symbol, side: "long", sizeUsdc: "10", leverage: 5 });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (isStaleOracle(body)) return; // upstream feed lag — endpoint behaved correctly
      expect(body.total).toContain("USDC");
      expect(body.margin).toContain("USDC");
      expect(body.fee).toContain("USDC");
    });
  }
});

// ── Spot ──

describe("spot", () => {
  for (const symbol of ["EURC", "JPYC", "MXNB"]) {
    test(`${symbol} spot quote returns price`, async () => {
      const res = await post("/api/spot/quote", { symbol, amountUsdc: "100" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.symbol).toBe(symbol);
      expect(body.routeId).toMatch(/^0x/);
    });
  }

  test("rejects invalid spot symbol", async () => {
    const res = await post("/api/spot/quote", { symbol: "CHF", amountUsdc: "100" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Lending ──

describe("lending", () => {
  test("GET /api/lending/markets returns pools", async () => {
    const res = await get("/api/lending/markets");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markets.length).toBeGreaterThan(0);
  });
});

// ── Leaderboard ──

describe("leaderboard", () => {
  test("GET /api/leaderboard returns rankings", async () => {
    const res = await get("/api/leaderboard");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaderboard).toBeDefined();
    expect(body.total_traders).toBeNumber();
  });
});
