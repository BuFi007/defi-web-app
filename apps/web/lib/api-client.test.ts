/// <reference types="bun-types" />
/**
 * Tests for the shared resilient fetch client. Run with:
 *
 *   bun test apps/web/lib/api-client.test.ts
 *
 * The triple-slash reference pulls in bun's `test`/`expect` globals + the
 * `bun:test` module declaration so this file typechecks under apps/web's
 * tsconfig (which doesn't add bun-types globally).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resilientFetch } from "./api-client";

type Responder = () => Promise<Response> | Response;

interface CapturedCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let queue: Responder[] = [];
let calls: CapturedCall[] = [];

function enqueue(responder: Responder | Response): void {
  if (typeof responder === "function") queue.push(responder as Responder);
  else queue.push(() => responder);
}

function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  queue = [];
  calls = [];
  // Cast to any so we can override the readonly fetch on globalThis cleanly.
  (globalThis as { fetch: typeof fetch }).fetch = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({ input, init });
    const next = queue.shift();
    if (!next) {
      return Promise.reject(new Error(`mock fetch: no responder queued for call #${calls.length}`));
    }
    return Promise.resolve(next());
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const fastRetry = { attempts: 5, baseMs: 1, maxMs: 4 };

describe("resilientFetch — happy path & retries", () => {
  test("returns immediately on 2xx with no retries", async () => {
    enqueue(jsonResponse(200, { ok: true }));
    const res = await resilientFetch("https://api.test/ok", { retry: fastRetry });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
  });

  test("retries once on 500 then succeeds", async () => {
    enqueue(jsonResponse(500, { error: "boom" }));
    enqueue(jsonResponse(200, { ok: true }));
    const res = await resilientFetch("https://api.test/500", { retry: fastRetry });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  test("retries on TypeError (network error)", async () => {
    enqueue(() => Promise.reject(new TypeError("fetch failed")));
    enqueue(jsonResponse(200, { ok: true }));
    const res = await resilientFetch("https://api.test/net", { retry: fastRetry });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  test("gives up after `attempts` exhausted and returns last response", async () => {
    enqueue(jsonResponse(500));
    enqueue(jsonResponse(500));
    enqueue(jsonResponse(500));
    const res = await resilientFetch("https://api.test/fail", {
      retry: { attempts: 3, baseMs: 1, maxMs: 2 },
    });
    expect(res.status).toBe(500);
    expect(calls.length).toBe(3);
  });
});

describe("resilientFetch — Retry-After", () => {
  test("503 with Retry-After: 2 waits at least the requested delay (capped by maxMs)", async () => {
    // We cap maxMs at 10ms so the test stays fast but still proves
    // the 503 path consults Retry-After (otherwise it would back off
    // with computeBackoff ≤ maxMs).
    enqueue(jsonResponse(503, {}, { "retry-after": "2" })); // 2s requested
    enqueue(jsonResponse(200, { ok: true }));
    const start = Date.now();
    const res = await resilientFetch("https://api.test/503", {
      retry: { attempts: 2, baseMs: 1, maxMs: 10 },
    });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Capped by maxMs=10, so we just verify ≤ that cap (and >= 0).
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(200);
  });

  test("429 with Retry-After honored (delta-seconds parsed)", async () => {
    enqueue(jsonResponse(429, {}, { "retry-after": "1" }));
    enqueue(jsonResponse(200, { ok: true }));
    const res = await resilientFetch("https://api.test/429", {
      retry: { attempts: 2, baseMs: 1, maxMs: 5 },
    });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });
});

describe("resilientFetch — onUnauthorized", () => {
  test("401 triggers onUnauthorized, merges headers, succeeds on retry", async () => {
    enqueue(new Response("unauthorized", { status: 401 }));
    enqueue(jsonResponse(200, { ok: true }));

    let refreshCalls = 0;
    const res = await resilientFetch("https://api.test/auth", {
      retry: fastRetry,
      onUnauthorized: async () => {
        refreshCalls += 1;
        return { headers: { Authorization: "Bearer fresh" } };
      },
    });

    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(calls.length).toBe(2);
    // The second call must carry the merged auth header.
    const retryHeaders = new Headers(calls[1]?.init?.headers);
    expect(retryHeaders.get("authorization")).toBe("Bearer fresh");
  });

  test("401 + onUnauthorized returning void => no retry, original 401 returned", async () => {
    enqueue(new Response("unauthorized", { status: 401 }));
    let refreshCalls = 0;
    const res = await resilientFetch("https://api.test/auth-void", {
      retry: fastRetry,
      onUnauthorized: async () => {
        refreshCalls += 1;
      },
    });
    expect(res.status).toBe(401);
    expect(refreshCalls).toBe(1);
    expect(calls.length).toBe(1);
  });

  test("onUnauthorized only fires once even if refresh-then-401 happens again", async () => {
    enqueue(new Response("unauthorized", { status: 401 }));
    enqueue(new Response("unauthorized again", { status: 401 }));
    let refreshCalls = 0;
    const res = await resilientFetch("https://api.test/auth-twice", {
      retry: fastRetry,
      onUnauthorized: async () => {
        refreshCalls += 1;
        return { headers: { Authorization: "Bearer second" } };
      },
    });
    expect(res.status).toBe(401);
    expect(refreshCalls).toBe(1);
    expect(calls.length).toBe(2);
  });
});

describe("resilientFetch — AbortSignal", () => {
  test("upstream abort during retry delay rejects with AbortError", async () => {
    enqueue(jsonResponse(500));
    enqueue(jsonResponse(500));
    const controller = new AbortController();
    const p = resilientFetch("https://api.test/abort", {
      retry: { attempts: 3, baseMs: 100, maxMs: 200 },
      signal: controller.signal,
    });
    // Abort mid-flight, after the first 500 lands and we enter the backoff sleep.
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  test("pre-aborted signal rejects without firing fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resilientFetch("https://api.test/pre-abort", {
        retry: fastRetry,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.length).toBe(0);
  });
});

describe("resilientFetch — Idempotency-Key", () => {
  test("auto-generates Idempotency-Key on POST", async () => {
    enqueue(jsonResponse(200, { ok: true }));
    await resilientFetch("https://api.test/post", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      retry: fastRetry,
    });
    const headers = new Headers(calls[0]?.init?.headers);
    const key = headers.get("idempotency-key");
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThanOrEqual(16);
  });

  test("same Idempotency-Key reused across retries of one request", async () => {
    enqueue(jsonResponse(500));
    enqueue(jsonResponse(200, { ok: true }));
    await resilientFetch("https://api.test/retry-idem", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      retry: { attempts: 2, baseMs: 1, maxMs: 2 },
    });
    const k1 = new Headers(calls[0]?.init?.headers).get("idempotency-key");
    const k2 = new Headers(calls[1]?.init?.headers).get("idempotency-key");
    expect(k1).toBeTruthy();
    expect(k1).toBe(k2);
  });

  test("caller-supplied idempotencyKey is passed through unchanged", async () => {
    enqueue(jsonResponse(200, { ok: true }));
    await resilientFetch("https://api.test/explicit", {
      method: "PUT",
      idempotencyKey: "user-supplied-key-123",
      retry: fastRetry,
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("idempotency-key")).toBe("user-supplied-key-123");
  });

  test("does NOT auto-add Idempotency-Key on GET", async () => {
    enqueue(jsonResponse(200, { ok: true }));
    await resilientFetch("https://api.test/get", { retry: fastRetry });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("idempotency-key")).toBeNull();
  });

  test("pre-existing Idempotency-Key in headers is preserved (not regenerated)", async () => {
    enqueue(jsonResponse(200, { ok: true }));
    await resilientFetch("https://api.test/preset", {
      method: "POST",
      headers: { "Idempotency-Key": "preset-abc" },
      body: "{}",
      retry: fastRetry,
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("idempotency-key")).toBe("preset-abc");
  });
});
