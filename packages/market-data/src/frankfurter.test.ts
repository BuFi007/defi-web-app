/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { fetchFrankfurterDailyHistory } from "./frankfurter";

describe("fetchFrankfurterDailyHistory", () => {
  test("fetches a bounded daily FX window and turns closes into candles", async () => {
    let requestedUrl = "";
    const fetchImpl = async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify([
          { date: "2020-01-01", base: "EUR", quote: "USD", rate: 1.12 },
          { date: "2020-01-02", base: "EUR", quote: "USD", rate: 1.13 },
          { date: "2020-01-03", base: "EUR", quote: "USD", rate: 1.11 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const candles = await fetchFrankfurterDailyHistory({
      uiSymbol: "EUR/USD",
      limit: 2,
      from: Date.parse("2020-01-01T00:00:00.000Z") / 1000,
      to: Date.parse("2020-01-03T00:00:00.000Z") / 1000,
      baseUrl: "https://frankfurter.example",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const url = new URL(requestedUrl);
    expect(url.origin).toBe("https://frankfurter.example");
    expect(url.pathname).toBe("/v2/rates");
    expect(url.searchParams.get("base")).toBe("EUR");
    expect(url.searchParams.get("quotes")).toBe("USD");
    expect(url.searchParams.get("from")).toBe("2020-01-01");
    expect(url.searchParams.get("to")).toBe("2020-01-03");
    expect(candles).toHaveLength(2);
    expect(candles.map((c) => c.c)).toEqual([1.13, 1.11]);
    expect(candles[1]!.o).toBe(1.13);
    expect(candles[1]!.h).toBe(1.13);
    expect(candles[1]!.l).toBe(1.11);
    expect(candles[1]!.v).toBeGreaterThan(0);
  });
});
