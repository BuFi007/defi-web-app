/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { fetchBenchmarksHistory } from "./benchmarks";

describe("fetchBenchmarksHistory", () => {
  test("passes cursor windows through to Pyth Benchmarks", async () => {
    let requestedUrl = "";
    const fetchImpl = async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          s: "ok",
          t: [1000, 1060],
          o: [1.1, 1.2],
          h: [1.15, 1.25],
          l: [1.05, 1.15],
          c: [1.12, 1.22],
          v: [0, 0],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const candles = await fetchBenchmarksHistory({
      uiSymbol: "EUR/USD",
      tf: "1m",
      limit: 2,
      from: 1000,
      to: 1120,
      baseUrl: "https://benchmarks.example",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const params = new URL(requestedUrl).searchParams;
    expect(params.get("symbol")).toBe("FX.EUR/USD");
    expect(params.get("resolution")).toBe("1");
    expect(params.get("from")).toBe("1000");
    expect(params.get("to")).toBe("1120");
    expect(candles.map((c) => c.time)).toEqual([1000, 1060]);
    expect(candles.every((c) => c.v > 0)).toBe(true);
  });
});
