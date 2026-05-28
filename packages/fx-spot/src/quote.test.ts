import { describe, expect, test } from "bun:test";
import { quoteSpotOut } from "./index";

describe("quoteSpotOut", () => {
  // 1:1 price (1.0 at expo -8): 10 USDC -> 10 tokens (6 decimals both sides).
  test("1:1 price, clean amounts", () => {
    const r = quoteSpotOut({ amountUsdc: "10", priceRaw: "100000000", expo: -8 });
    expect(r.expectedOut).toBe("10000000"); // 10.000000
    expect(r.minAmountOut).toBe("9900000"); // -1% default
    expect(r.slippageBps).toBe(100);
  });

  // EURC ~1.165 USD/token (live magnitude). 1 USDC buys ~0.858 EURC.
  test("EURC USD-per-token divides", () => {
    const r = quoteSpotOut({ amountUsdc: "1", priceRaw: "116520690", expo: -8 });
    // 1e6 * 1e8 / 116520690 = 858216 (floored) = 0.858216 EURC
    expect(r.expectedOut).toBe("858216");
  });

  // JPYC ~0.00159 USD/token. 1 USDC buys ~628 JPYC.
  test("JPYC tiny USD-per-token yields large output", () => {
    const r = quoteSpotOut({ amountUsdc: "1", priceRaw: "159242", expo: -8 });
    // 1e14 / 159242 = 627975031 (floored) = 627.975031 JPYC
    expect(r.expectedOut).toBe("627975031");
  });

  // Fractional human input parsed without float drift.
  test("fractional amountUsdc", () => {
    const r = quoteSpotOut({ amountUsdc: "5.50", priceRaw: "100000000", expo: -8 });
    expect(r.expectedOut).toBe("5500000"); // 5.5 tokens at 1:1
  });

  // Custom slippage.
  test("custom slippageBps", () => {
    const r = quoteSpotOut({ amountUsdc: "10", priceRaw: "100000000", expo: -8, slippageBps: 50 });
    expect(r.minAmountOut).toBe("9950000"); // -0.5%
  });

  test("rejects non-positive price", () => {
    expect(() => quoteSpotOut({ amountUsdc: "1", priceRaw: "0", expo: -8 })).toThrow();
  });

  test("rejects out-of-range slippage", () => {
    expect(() =>
      quoteSpotOut({ amountUsdc: "1", priceRaw: "100000000", expo: -8, slippageBps: 10000 }),
    ).toThrow();
  });

  test("rejects malformed amountUsdc", () => {
    expect(() => quoteSpotOut({ amountUsdc: "abc", priceRaw: "100000000", expo: -8 })).toThrow();
  });
});
