/// <reference types="bun-types" />
/**
 * Unit tests for the B2B api-key middleware (Wave K4 / PR-H5).
 *
 * Covers:
 *   - Env parsing seeds both roles correctly.
 *   - `apiKey()` resolves the role onto `c.var.apiKeyRole`.
 *   - `requireRole(...)` short-circuits with 401 for missing / wrong role.
 *   - Anon (no header) sets null and never short-circuits.
 *   - Setter key wins when configured in both lists.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  apiKey,
  buildApiKeyRegistryFromEnv,
  requireRole,
  resolveApiKeyRole,
  setApiKeyRegistry,
} from "./api-key";

function harness() {
  const app = new Hono();
  app.use("*", apiKey());
  app.get("/anon", (c) => c.json({ role: c.var.apiKeyRole ?? null }));
  app.get("/setter-only", requireRole("market-setter"), (c) =>
    c.json({ ok: true }),
  );
  app.get("/taker-only", requireRole("market-taker"), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

describe("buildApiKeyRegistryFromEnv", () => {
  test("seeds both roles from CSV env vars", () => {
    const reg = buildApiKeyRegistryFromEnv({
      MARKET_SETTER_API_KEYS: "setter-a, setter-b",
      MARKET_TAKER_API_KEYS: "taker-a,taker-b",
    });
    expect(reg.keys.get("setter-a")).toBe("market-setter");
    expect(reg.keys.get("setter-b")).toBe("market-setter");
    expect(reg.keys.get("taker-a")).toBe("market-taker");
    expect(reg.keys.get("taker-b")).toBe("market-taker");
  });

  test("setter wins when the same key appears in both lists", () => {
    const reg = buildApiKeyRegistryFromEnv({
      MARKET_SETTER_API_KEYS: "dual",
      MARKET_TAKER_API_KEYS: "dual",
    });
    expect(reg.keys.get("dual")).toBe("market-setter");
  });

  test("empty env yields an empty registry", () => {
    const reg = buildApiKeyRegistryFromEnv({});
    expect(reg.keys.size).toBe(0);
  });
});

describe("resolveApiKeyRole", () => {
  test("returns null for missing / unknown headers", () => {
    setApiKeyRegistry(buildApiKeyRegistryFromEnv({ MARKET_SETTER_API_KEYS: "k1" }));
    expect(resolveApiKeyRole(undefined)).toBeNull();
    expect(resolveApiKeyRole("")).toBeNull();
    expect(resolveApiKeyRole("nope")).toBeNull();
  });

  test("returns the configured role on hit", () => {
    setApiKeyRegistry(
      buildApiKeyRegistryFromEnv({
        MARKET_SETTER_API_KEYS: "set1",
        MARKET_TAKER_API_KEYS: "tak1",
      }),
    );
    expect(resolveApiKeyRole("set1")).toBe("market-setter");
    expect(resolveApiKeyRole("tak1")).toBe("market-taker");
  });
});

describe("apiKey() + requireRole() integration", () => {
  test("anon request resolves to null role and passes through", async () => {
    setApiKeyRegistry(buildApiKeyRegistryFromEnv({}));
    const app = harness();
    const res = await app.request("http://localhost/anon");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: null });
  });

  test("requireRole('market-setter') blocks anon with 401", async () => {
    setApiKeyRegistry(buildApiKeyRegistryFromEnv({}));
    const app = harness();
    const res = await app.request("http://localhost/setter-only");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { required: string; have: string };
    expect(body.required).toBe("market-setter");
    expect(body.have).toBe("anon");
  });

  test("requireRole('market-setter') blocks taker key with 401", async () => {
    setApiKeyRegistry(
      buildApiKeyRegistryFromEnv({ MARKET_TAKER_API_KEYS: "tak1" }),
    );
    const app = harness();
    const res = await app.request("http://localhost/setter-only", {
      headers: { "X-API-Key": "tak1" },
    });
    expect(res.status).toBe(401);
  });

  test("requireRole('market-setter') passes for a setter key", async () => {
    setApiKeyRegistry(
      buildApiKeyRegistryFromEnv({ MARKET_SETTER_API_KEYS: "set1" }),
    );
    const app = harness();
    const res = await app.request("http://localhost/setter-only", {
      headers: { "X-API-Key": "set1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("requireRole('market-taker') passes only for taker, not setter", async () => {
    setApiKeyRegistry(
      buildApiKeyRegistryFromEnv({
        MARKET_SETTER_API_KEYS: "set1",
        MARKET_TAKER_API_KEYS: "tak1",
      }),
    );
    const app = harness();
    const setterRes = await app.request("http://localhost/taker-only", {
      headers: { "X-API-Key": "set1" },
    });
    expect(setterRes.status).toBe(401);
    const takerRes = await app.request("http://localhost/taker-only", {
      headers: { "X-API-Key": "tak1" },
    });
    expect(takerRes.status).toBe(200);
  });

  test("header lookup is case-insensitive on the header name only", async () => {
    setApiKeyRegistry(
      buildApiKeyRegistryFromEnv({ MARKET_SETTER_API_KEYS: "set1" }),
    );
    const app = harness();
    // Hono normalizes header names but values are case-sensitive — the
    // wrong-case value must still 401.
    const wrongValue = await app.request("http://localhost/setter-only", {
      headers: { "x-api-key": "SET1" },
    });
    expect(wrongValue.status).toBe(401);
    const rightValue = await app.request("http://localhost/setter-only", {
      headers: { "x-api-key": "set1" },
    });
    expect(rightValue.status).toBe(200);
  });
});
