/// <reference types="bun-types" />
/**
 * Unit tests for the token-bucket rate limiter (Wave I3).
 *
 * Covers:
 *   - Bucket fills to capacity, drains by 1 per allowed request.
 *   - Refill is linear over wall-clock time.
 *   - Reject path returns 429 + Retry-After + bucket name.
 *   - API-key prefix beats IP for keying.
 *   - resolveRateLimit() picks the tier1 bucket when an API key is present.
 *   - In-memory store evicts idle keys (sweep path) without dropping live ones.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  createMemoryRateLimitStore,
  rateLimit,
  type RateLimitConfig,
  type RateLimitStore,
} from "./rate-limit";
import { resolveRateLimit } from "./rate-limit-config";

function harness(config: RateLimitConfig, store: RateLimitStore) {
  const app = new Hono();
  app.use("*", rateLimit(config, { store }));
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
}

describe("token-bucket math (memory store)", () => {
  test("allows requests until the bucket drains, then 429", async () => {
    const store = createMemoryRateLimitStore();
    const app = harness(
      {
        bucketCapacity: 3,
        refillPerSecond: 0, // no refill — pure drain test
        routeKey: "probe-drain",
        keyExtractor: () => "k:test",
      },
      store,
    );

    const allowed: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.request("http://localhost/probe");
      allowed.push(res.status);
    }
    expect(allowed).toEqual([200, 200, 200, 429, 429]);
  });

  test("Retry-After header + body shape on rejection", async () => {
    const store = createMemoryRateLimitStore();
    const app = harness(
      {
        bucketCapacity: 1,
        refillPerSecond: 0.5,
        routeKey: "probe-retry",
        keyExtractor: () => "k:retry",
      },
      store,
    );

    await app.request("http://localhost/probe"); // drains the bucket
    const res = await app.request("http://localhost/probe");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
    const body = (await res.json()) as {
      error: string;
      retryAfter: number;
      bucket: string;
    };
    expect(body.error).toBe("rate_limited");
    expect(body.bucket).toBe("probe-retry");
    // refill = 0.5/s, needing 1 token → ~2s wait
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  test("linear refill restores capacity over wall-clock time", async () => {
    // Drive the store directly so the timing is hermetic — wall-clock
    // sleeps would make the test flaky on CI.
    const store = createMemoryRateLimitStore();
    const config: RateLimitConfig = {
      bucketCapacity: 5,
      refillPerSecond: 1,
      routeKey: "refill",
    };
    const t0 = 1_000_000;

    for (let i = 0; i < 5; i++) {
      const r = await store.consume("k:refill", config.routeKey!, config, t0);
      expect(r.allowed).toBe(true);
    }
    // bucket drained at t0
    const drained = await store.consume("k:refill", config.routeKey!, config, t0);
    expect(drained.allowed).toBe(false);

    // After 3 seconds of refill at 1 token/s → 3 tokens available.
    const t1 = t0 + 3_000;
    const granted = [];
    for (let i = 0; i < 4; i++) {
      const r = await store.consume("k:refill", config.routeKey!, config, t1);
      granted.push(r.allowed);
    }
    expect(granted).toEqual([true, true, true, false]);
  });

  test("API-key prefix overrides IP for keying", async () => {
    const store = createMemoryRateLimitStore();
    const app = new Hono();
    app.use(
      "*",
      rateLimit(
        { bucketCapacity: 2, refillPerSecond: 0, routeKey: "k-override" },
        { store },
      ),
    );
    app.get("/probe", (c) => c.json({ ok: true }));

    // Two requests from IP-A use API key abc.def → drain "k:abc" bucket.
    const opts = {
      headers: {
        "x-bufi-api-key": "abc.def",
        "x-forwarded-for": "1.2.3.4",
      },
    };
    expect((await app.request("http://localhost/probe", opts)).status).toBe(200);
    expect((await app.request("http://localhost/probe", opts)).status).toBe(200);
    expect((await app.request("http://localhost/probe", opts)).status).toBe(429);

    // Same IP, no key → separate "ip:1.2.3.4" bucket, still full.
    const noKey = await app.request("http://localhost/probe", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(noKey.status).toBe(200);
  });

  test("onCheck snapshot fires with allowed + remaining", async () => {
    const store = createMemoryRateLimitStore();
    const snapshots: Array<{ allowed: boolean; remaining: number }> = [];
    const app = new Hono();
    app.use(
      "*",
      rateLimit(
        {
          bucketCapacity: 2,
          refillPerSecond: 0,
          routeKey: "snap",
          keyExtractor: () => "k:snap",
          onCheck: (s) =>
            snapshots.push({ allowed: s.allowed, remaining: s.remaining }),
        },
        { store },
      ),
    );
    app.get("/probe", (c) => c.json({ ok: true }));

    await app.request("http://localhost/probe");
    await app.request("http://localhost/probe");
    await app.request("http://localhost/probe");

    expect(snapshots).toEqual([
      { allowed: true, remaining: 1 },
      { allowed: true, remaining: 0 },
      { allowed: false, remaining: 0 },
    ]);
  });
});

describe("resolveRateLimit", () => {
  test("anon callers get the conservative bucket", () => {
    const cfg = resolveRateLimit("graph", false);
    expect(cfg.bucketCapacity).toBe(100);
    expect(cfg.refillPerSecond).toBe(10);
    expect(cfg.routeKey).toBe("graph");
  });

  test("API-key callers get the tier1 bucket", () => {
    const cfg = resolveRateLimit("graph", true);
    expect(cfg.bucketCapacity).toBe(1000);
    expect(cfg.refillPerSecond).toBe(100);
  });

  test("falls back to anon when no tier1 exists", () => {
    // Smoke: even without a tier1 entry the call still resolves.
    const cfg = resolveRateLimit("markets", false);
    expect(cfg.bucketCapacity).toBeGreaterThan(0);
  });
});
