import { describe, expect, test } from "bun:test";

import { livePerpsMarketIds, livePerpsMarkets } from "./markets";

describe("live perps markets", () => {
  test("uses configured Arc clearinghouse market ids instead of request-layer route ids", () => {
    const markets = livePerpsMarkets(5042002);

    expect(markets.map((market) => market.symbol)).toEqual([
      "EURC/USDC",
      "tJPYC/USDC",
      "MXNB/USDC",
      "CIRBTC/USDC",
      "AUDF/USDC",
    ]);
    expect(markets.map((market) => market.marketId)).toEqual([
      "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
      "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
      "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
      "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
      "0x921b564f97b14b7d73c12a72af4b7847fb5e3414f98cbe5fb5f1d8a3168c0a00",
    ]);
    expect(markets.every((market) => market.chainId === 5042002)).toBe(true);
    expect(markets.every((market) => market.source === "pyth")).toBe(true);
  });

  test("includes configured perps market ids without duplicating protocol ids", () => {
    const previous = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({
      5042002: {
        perps: {
          markets: {
            "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8":
              "0x1111111111111111111111111111111111111111",
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":
              "0x2222222222222222222222222222222222222222",
          },
        },
      },
    });

    try {
      expect(livePerpsMarketIds(5042002)).toEqual([
        "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
        "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
        "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
        "0x921b564f97b14b7d73c12a72af4b7847fb5e3414f98cbe5fb5f1d8a3168c0a00",
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      } else {
        process.env.CONTRACT_ADDRESSES_JSON = previous;
      }
    }
  });
});
