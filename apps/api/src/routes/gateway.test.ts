/// <reference types="bun-types" />
/**
 * Integration tests for the Circle Gateway proxy route.
 *
 * We mock `globalThis.fetch` to intercept the upstream POST to
 * `gateway-api-testnet.circle.com/v1/balances`; the rest of the route
 * (address validation, domain→chainId rekey, decimal summation) runs
 * end-to-end against the real Hono app.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { gatewayRoutes } from "./gateway";

const ADDRESS = "0xAbCdEf0123456789ABCDEF0123456789aBcDeF01";

function harness() {
  const app = new Hono();
  app.route("/", gatewayRoutes);
  return app;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  // Restore between tests; individual tests install their own mock.
  globalThis.fetch = realFetch;
  delete process.env.CIRCLE_GATEWAY_API_KEY;
  delete process.env.CIRCLE_GATEWAY_API_URL;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("gateway proxy", () => {
  test("GET /balance/:address with an invalid address returns 400", async () => {
    const app = harness();
    const res = await app.request("/balance/not-an-address");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid address/i);
  });

  test("GET /balance/:address with an invalid env returns 400", async () => {
    const app = harness();
    const res = await app.request(`/balance/${ADDRESS}?env=bogus`);
    expect(res.status).toBe(400);
  });

  test("happy path — rekeys upstream balances by chainId and sums total", async () => {
    let receivedBody: unknown = null;
    let receivedAuthHeader: string | null = null;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      receivedBody = init?.body ? JSON.parse(init.body as string) : null;
      receivedAuthHeader = new Headers(init?.headers ?? {}).get("authorization");
      return new Response(
        JSON.stringify({
          token: "USDC",
          balances: [
            { domain: 1, depositor: ADDRESS, balance: "5.000000" }, // Fuji
            { domain: 26, depositor: ADDRESS, balance: "7.345670" }, // Arc Testnet
            { domain: 0, depositor: ADDRESS, balance: "0.000000" }, // Sepolia
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const app = harness();
    const res = await app.request(`/balance/${ADDRESS}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      total: string;
      perChain: Record<string, string>;
      perDomain: Record<string, string>;
      env: string;
    };

    // 5.0 + 7.345670 + 0 = 12.345670, formatted as a 6-dp decimal string.
    expect(body.total).toBe("12.345670");
    // Rekeyed by chainId — Fuji=43113, Arc=5042002, Sepolia=11155111.
    expect(body.perChain["43113"]).toBe("5.000000");
    expect(body.perChain["5042002"]).toBe("7.345670");
    expect(body.perChain["11155111"]).toBe("0.000000");
    expect(body.env).toBe("testnet");

    // Upstream got the testnet endpoint and a sources[] that includes
    // both Fuji (1) and Arc Testnet (26).
    const upstreamBody = receivedBody as {
      token: string;
      sources: { domain: number; depositor: string }[];
    };
    expect(upstreamBody.token).toBe("USDC");
    const domains = upstreamBody.sources.map((s) => s.domain);
    expect(domains).toContain(1);
    expect(domains).toContain(26);

    // No Authorization header when key is absent — proxy stays anonymous.
    expect(receivedAuthHeader).toBeNull();
  });

  test("forwards the Circle API key as Bearer when present", async () => {
    process.env.CIRCLE_GATEWAY_API_KEY = "test-key-shhh";
    const captured: { auth: string | null } = { auth: null };
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      captured.auth = new Headers(init?.headers ?? {}).get("authorization");
      return new Response(
        JSON.stringify({ token: "USDC", balances: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const app = harness();
    const res = await app.request(`/balance/${ADDRESS}`);
    expect(res.status).toBe(200);
    expect(captured.auth).toBe("Bearer test-key-shhh");
  });

  test("upstream non-2xx is surfaced as 502", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "denied" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const app = harness();
    const res = await app.request(`/balance/${ADDRESS}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; detail: unknown };
    expect(body.error).toMatch(/upstream 403/);
  });

  test("upstream network failure is surfaced as 502", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const app = harness();
    const res = await app.request(`/balance/${ADDRESS}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unreachable/i);
  });
});
