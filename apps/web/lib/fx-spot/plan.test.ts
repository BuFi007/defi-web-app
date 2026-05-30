import { describe, expect, test } from "bun:test";

import {
  buildFxSpotSwapPlan,
  formatFxSpotAmount,
  resolveFxSpotRoute,
} from "./plan";

describe("fx spot swap planner", () => {
  test("plans EUR/USD buy as USDC -> EURC", () => {
    const plan = buildFxSpotSwapPlan({
      marketSymbol: "EUR/USD",
      side: "long",
      size: 10,
      price: 1.08,
    });
    expect(plan.sellSymbol).toBe("USDC");
    expect(plan.buySymbol).toBe("EURC");
    expect(formatFxSpotAmount(plan.sellAmount)).toBe("10.8");
    expect(formatFxSpotAmount(plan.expectedBuyAmount)).toBe("10");
    expect(formatFxSpotAmount(plan.minBuyAmount)).toBe("9.9");
  });

  test("plans USD/MXN buy as MXNB -> USDC", () => {
    const plan = buildFxSpotSwapPlan({
      marketSymbol: "USD/MXN",
      side: "long",
      size: 100,
      price: 17.25,
    });
    expect(plan.sellSymbol).toBe("MXNB");
    expect(plan.buySymbol).toBe("USDC");
    expect(formatFxSpotAmount(plan.sellAmount)).toBe("1725");
    expect(formatFxSpotAmount(plan.expectedBuyAmount)).toBe("100");
  });

  test("exposes only the live vault-backed spot markets", () => {
    expect(resolveFxSpotRoute("AUD/USD")?.fxSymbol).toBe("AUDF");
    expect(resolveFxSpotRoute("USD/CAD")?.fxSymbol).toBe("QCAD");
    expect(resolveFxSpotRoute("USD/JPY")).toBeNull();
  });
});
