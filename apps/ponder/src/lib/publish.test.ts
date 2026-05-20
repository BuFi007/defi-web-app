/**
 * Unit tests for the Wave F2 publish helper.
 *
 * Verifies the "silent no-op when no token" contract and the basic fetch
 * wiring. We mock `globalThis.fetch` and snapshot the bodies / headers
 * to assert the wire shape matches PR #56 and PR #58 exactly.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { publishEvent } from "./publish";

const originalFetch = globalThis.fetch;
const originalRealtimeToken = process.env.INTERNAL_REALTIME_TOKEN;
const originalIngestToken = process.env.INTERNAL_INGEST_TOKEN;
const originalApiBase = process.env.PONDER_PUBLISH_API_BASE;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalRealtimeToken === undefined) delete process.env.INTERNAL_REALTIME_TOKEN;
  else process.env.INTERNAL_REALTIME_TOKEN = originalRealtimeToken;
  if (originalIngestToken === undefined) delete process.env.INTERNAL_INGEST_TOKEN;
  else process.env.INTERNAL_INGEST_TOKEN = originalIngestToken;
  if (originalApiBase === undefined) delete process.env.PONDER_PUBLISH_API_BASE;
  else process.env.PONDER_PUBLISH_API_BASE = originalApiBase;
});

describe("publishEvent — silent no-op", () => {
  beforeEach(() => {
    delete process.env.INTERNAL_REALTIME_TOKEN;
    delete process.env.INTERNAL_INGEST_TOKEN;
  });

  test("does nothing when no tokens set even if envelope is full", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock;

    await publishEvent({
      realtime: { kind: "trades", marketId: "EUR-USD", data: { side: "long" } },
      analytics: { dataset: "perp_match_settled", row: { eventId: "x-0" } },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("only realtime fires when ingest token unset", async () => {
    process.env.INTERNAL_REALTIME_TOKEN = "rt-secret";
    delete process.env.INTERNAL_INGEST_TOKEN;
    const fetchMock = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock;

    await publishEvent({
      realtime: { kind: "trades", marketId: "EUR-USD", data: { ts: 1 } },
      analytics: { dataset: "perp_match_settled", row: { eventId: "x-0" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/internal/realtime/publish");
  });

  test("only analytics fires when realtime token unset", async () => {
    delete process.env.INTERNAL_REALTIME_TOKEN;
    process.env.INTERNAL_INGEST_TOKEN = "tb-secret";
    const fetchMock = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock;

    await publishEvent({
      realtime: { kind: "trades", marketId: "EUR-USD", data: { ts: 1 } },
      analytics: { dataset: "perp_match_settled", row: { eventId: "x-0" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/internal/tinybird/ingest");
  });
});

describe("publishEvent — both legs", () => {
  beforeEach(() => {
    process.env.INTERNAL_REALTIME_TOKEN = "rt-secret";
    process.env.INTERNAL_INGEST_TOKEN = "tb-secret";
    process.env.PONDER_PUBLISH_API_BASE = "http://api.test:3002";
  });

  test("dispatches realtime + tinybird in parallel with the right headers/body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await publishEvent({
      realtime: {
        kind: "trades",
        marketId: "EUR-USD",
        data: { priceE18: "1", sizeE18: "1", side: "long", ts: 1 },
      },
      analytics: {
        dataset: "perp_position_change",
        row: { eventId: "0xabc-0" },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const realtimeCall = calls.find((c) => c.url.endsWith("/internal/realtime/publish"))!;
    expect(realtimeCall.init.method).toBe("POST");
    expect((realtimeCall.init.headers as Record<string, string>)["X-Internal-Token"]).toBe(
      "rt-secret",
    );
    const realtimeBody = JSON.parse(realtimeCall.init.body as string);
    expect(realtimeBody.kind).toBe("trades");
    expect(realtimeBody.marketId).toBe("EUR-USD");
    expect(realtimeBody.data.side).toBe("long");

    const tinybirdCall = calls.find((c) => c.url.endsWith("/internal/tinybird/ingest"))!;
    expect((tinybirdCall.init.headers as Record<string, string>)["X-Internal-Token"]).toBe(
      "tb-secret",
    );
    const tinybirdBody = JSON.parse(tinybirdCall.init.body as string);
    expect(tinybirdBody.dataset).toBe("perp_position_change");
    expect(tinybirdBody.row.eventId).toBe("0xabc-0");
  });

  test("swallows fetch rejections (fire-and-forget)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("redis down");
    }) as unknown as typeof fetch;

    // Should not throw — DB write is the source of truth.
    await expect(
      publishEvent({
        realtime: { kind: "trades", marketId: "EUR-USD", data: {} },
      }),
    ).resolves.toBeUndefined();
  });

  test("swallows non-2xx responses", async () => {
    globalThis.fetch = mock(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      publishEvent({
        analytics: { dataset: "perp_match_settled", row: {} },
      }),
    ).resolves.toBeUndefined();
  });
});
