import { describe, expect, test } from "bun:test";

import {
  BPS,
  DEFAULT_MAINTENANCE_LOSS_BPS,
  HEALTH_FACTOR_INFINITY,
  calculateFundingPayment,
  calculateHealthFactor,
  calculateInitialMargin,
  calculateLiquidationPrice,
  calculateMaintenanceMargin,
  calculateMaxLeverage,
  calculatePriceImpact,
  calculateSlippage,
  calculateUnrealizedPnl,
  liquidationPriceFloat,
  requiredMarginFloat,
} from "./index";
import { WAD, parseUnits } from "./decimal";

const E6 = 10n ** 6n;

describe("calculateInitialMargin", () => {
  test("happy path: $1000 @ 10x = $100", () => {
    expect(calculateInitialMargin(1000n * E6, 10)).toBe(100n * E6);
  });

  test("zero size returns zero", () => {
    expect(calculateInitialMargin(0n, 10)).toBe(0n);
  });

  test("max leverage (100x) returns 1% of notional", () => {
    expect(calculateInitialMargin(1000n * E6, 100)).toBe(10n * E6);
  });

  test("throws on leverage <= 0", () => {
    expect(() => calculateInitialMargin(1000n * E6, 0)).toThrow();
    expect(() => calculateInitialMargin(1000n * E6, -1)).toThrow();
  });

  test("precision: $1 @ 3x is exact (1_000_000 / 3 = 333_333 atomic, no float drift)", () => {
    // 1.0 / 3 in float is 0.3333333333333333 → if you go through float you
    // lose the trailing precision; bigint keeps it exact.
    expect(calculateInitialMargin(1_000_000n, 3)).toBe(333_333n);
  });
});

describe("calculateMaintenanceMargin", () => {
  test("happy path: 6.25% maintenance = 625 bps on $1000 = $62.50", () => {
    expect(calculateMaintenanceMargin(1000n * E6, 625)).toBe(62_500_000n);
  });

  test("zero size returns zero", () => {
    expect(calculateMaintenanceMargin(0n, 500)).toBe(0n);
  });
});

describe("calculateLiquidationPrice", () => {
  // Matches the legacy inline math:
  //   liqLong  = price * (1 - 0.8 / lev)
  //   liqShort = price * (1 + 0.8 / lev)
  test("happy path long @ 10x equals price * (1 - 0.08)", () => {
    const entry = 100n * WAD;
    const sizeQty = 10n * WAD; // 10 units of base
    const notional = 1000n * E6; // 10 * 100 USDC
    const margin = notional / 10n; // 100 USDC
    const liq = calculateLiquidationPrice({
      entryPriceE18: entry,
      sizeE18: sizeQty,
      marginE6: margin,
      side: "long",
    });
    // 100 * (1 - 0.08) = 92
    expect(liq).toBe(92n * WAD);
  });

  test("short side mirror @ 10x equals price * (1 + 0.08)", () => {
    const entry = 100n * WAD;
    const sizeQty = 10n * WAD;
    const margin = (10n * 100n * E6) / 10n;
    const liq = calculateLiquidationPrice({
      entryPriceE18: entry,
      sizeE18: sizeQty,
      marginE6: margin,
      side: "short",
    });
    expect(liq).toBe(108n * WAD);
  });

  test("zero size returns entry (no exposure)", () => {
    expect(
      calculateLiquidationPrice({
        entryPriceE18: 100n * WAD,
        sizeE18: 0n,
        marginE6: 100n * E6,
        side: "long",
      }),
    ).toBe(100n * WAD);
  });

  test("max leverage (100x) → tiny buffer (0.8%)", () => {
    const entry = 100n * WAD;
    const sizeQty = 100n * WAD;
    const margin = (100n * 100n * E6) / 100n; // 100 USDC margin
    const liq = calculateLiquidationPrice({
      entryPriceE18: entry,
      sizeE18: sizeQty,
      marginE6: margin,
      side: "long",
    });
    // 100 * (1 - 0.008) = 99.2
    expect(liq).toBe(parseUnits("99.2", 18));
  });

  test("over-levered short clamps long-side liq at 0", () => {
    // Pathological margin → maint loss exceeds entry → would go negative.
    const entry = 1n * WAD;
    const sizeQty = 1n * WAD;
    const margin = 100n * E6; // way more margin than position is worth
    const liq = calculateLiquidationPrice({
      entryPriceE18: entry,
      sizeE18: sizeQty,
      marginE6: margin,
      side: "long",
    });
    expect(liq).toBe(0n);
  });

  test("respects DEFAULT_MAINTENANCE_LOSS_BPS == 8000", () => {
    expect(DEFAULT_MAINTENANCE_LOSS_BPS).toBe(8000);
  });
});

describe("calculateUnrealizedPnl", () => {
  test("happy path long: +1% on 100 units of $50 = +50 USDC", () => {
    const pnl = calculateUnrealizedPnl({
      entryPriceE18: 50n * WAD,
      markPriceE18: parseUnits("50.5", 18),
      sizeE18: 100n * WAD,
      side: "long",
    });
    expect(pnl).toBe(50n * E6);
  });

  test("short side mirror: same move = -50 USDC", () => {
    const pnl = calculateUnrealizedPnl({
      entryPriceE18: 50n * WAD,
      markPriceE18: parseUnits("50.5", 18),
      sizeE18: 100n * WAD,
      side: "short",
    });
    expect(pnl).toBe(-50n * E6);
  });

  test("zero size returns zero", () => {
    expect(
      calculateUnrealizedPnl({
        entryPriceE18: 100n * WAD,
        markPriceE18: 200n * WAD,
        sizeE18: 0n,
        side: "long",
      }),
    ).toBe(0n);
  });

  test("zero price (mark == entry) returns zero", () => {
    expect(
      calculateUnrealizedPnl({
        entryPriceE18: 100n * WAD,
        markPriceE18: 100n * WAD,
        sizeE18: 1n * WAD,
        side: "long",
      }),
    ).toBe(0n);
  });

  test("precision: a 0.1 + 0.2 style move is exact", () => {
    // Float would give 0.30000000000000004 — bigint stays exact.
    const entry = parseUnits("0.1", 18);
    const mark = parseUnits("0.3", 18); // delta = 0.2 exactly
    const size = parseUnits("1", 18);
    const pnl = calculateUnrealizedPnl({
      entryPriceE18: entry,
      markPriceE18: mark,
      sizeE18: size,
      side: "long",
    });
    // 0.2 USD * 1 unit = 0.2 USDC = 200_000 atomic
    expect(pnl).toBe(200_000n);
  });
});

describe("calculateFundingPayment", () => {
  test("happy path: 1% per second over 1 second on 100 units", () => {
    const payment = calculateFundingPayment({
      sizeE18: 100n * WAD,
      fundingRateE18: parseUnits("0.01", 18),
      intervalSeconds: 1,
    });
    // 100 * 0.01 * 1 = 1.0 USD
    expect(payment).toBe(1n * E6);
  });

  test("zero size returns zero", () => {
    expect(
      calculateFundingPayment({
        sizeE18: 0n,
        fundingRateE18: parseUnits("1", 18),
        intervalSeconds: 3600,
      }),
    ).toBe(0n);
  });

  test("zero interval returns zero", () => {
    expect(
      calculateFundingPayment({
        sizeE18: 100n * WAD,
        fundingRateE18: parseUnits("1", 18),
        intervalSeconds: 0,
      }),
    ).toBe(0n);
  });
});

describe("calculateMaxLeverage", () => {
  test("happy path: 25x = 250_000 bps", () => {
    expect(calculateMaxLeverage({ maxLeverageBps: 250_000 })).toBe(25);
  });

  test("max: 100x = 1_000_000 bps", () => {
    expect(calculateMaxLeverage({ maxLeverageBps: 1_000_000 })).toBe(100);
  });

  test("throws on 0", () => {
    expect(() => calculateMaxLeverage({ maxLeverageBps: 0 })).toThrow();
  });
});

describe("calculateHealthFactor", () => {
  test("happy path: 1000 collateral, 500 debt, 80% LLTV → 1.6 (= 16_000 bps)", () => {
    const hf = calculateHealthFactor({
      collateralValueE18: 1000n * WAD,
      borrowedValueE18: 500n * WAD,
      liquidationLtvBps: 8_000,
    });
    expect(hf).toBe(16_000n);
  });

  test("no debt returns sentinel infinity", () => {
    const hf = calculateHealthFactor({
      collateralValueE18: 1000n * WAD,
      borrowedValueE18: 0n,
      liquidationLtvBps: 8_000,
    });
    expect(hf).toBe(HEALTH_FACTOR_INFINITY);
  });

  test("just-liquidatable: collateral*lltv == debt → hf = 1 (= 10_000 bps)", () => {
    const hf = calculateHealthFactor({
      collateralValueE18: 1000n * WAD,
      borrowedValueE18: 800n * WAD,
      liquidationLtvBps: 8_000,
    });
    expect(hf).toBe(10_000n);
  });
});

describe("calculateSlippage", () => {
  test("happy path: 50 bps slip", () => {
    const slip = calculateSlippage({
      expectedPriceE18: 100n * WAD,
      fillPriceE18: parseUnits("100.5", 18),
    });
    expect(slip).toBe(50n);
  });

  test("zero slippage when fill matches expected", () => {
    expect(
      calculateSlippage({
        expectedPriceE18: 100n * WAD,
        fillPriceE18: 100n * WAD,
      }),
    ).toBe(0n);
  });

  test("abs: negative direction still positive bps", () => {
    const slip = calculateSlippage({
      expectedPriceE18: 100n * WAD,
      fillPriceE18: parseUnits("99.5", 18),
    });
    expect(slip).toBe(50n);
  });

  test("throws on zero expected price", () => {
    expect(() => calculateSlippage({ expectedPriceE18: 0n, fillPriceE18: 1n })).toThrow();
  });
});

describe("calculatePriceImpact", () => {
  test("happy path: 10% of depth → 1000 bps", () => {
    expect(calculatePriceImpact({ sizeE18: 10n * WAD, depthE18: 100n * WAD })).toBe(1_000n);
  });

  test("zero size returns zero", () => {
    expect(calculatePriceImpact({ sizeE18: 0n, depthE18: 100n * WAD })).toBe(0n);
  });

  test("throws on zero depth", () => {
    expect(() => calculatePriceImpact({ sizeE18: 1n, depthE18: 0n })).toThrow();
  });
});

describe("float wrappers (UI shims)", () => {
  test("requiredMarginFloat matches notional / lev", () => {
    expect(requiredMarginFloat(1000, 10)).toBe(100);
    expect(requiredMarginFloat(1234.56, 5)).toBeCloseTo(246.912, 6);
  });

  test("liquidationPriceFloat long matches inline formula price * (1 - 0.8/lev)", () => {
    const price = 100;
    const lev = 10;
    const expected = price * (1 - 0.8 / lev);
    expect(liquidationPriceFloat({ entryPrice: price, notionalUsd: 1000, leverage: lev, side: "long" })).toBeCloseTo(
      expected,
      6,
    );
  });

  test("liquidationPriceFloat short matches inline formula price * (1 + 0.8/lev)", () => {
    const price = 100;
    const lev = 10;
    const expected = price * (1 + 0.8 / lev);
    expect(liquidationPriceFloat({ entryPrice: price, notionalUsd: 1000, leverage: lev, side: "short" })).toBeCloseTo(
      expected,
      6,
    );
  });
});

describe("decimal helpers", () => {
  test("parseUnits round-trip with formatUnits-equivalent precision", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("0.0000001", 6)).toBe(0n); // truncates beyond decimals
    expect(parseUnits("", 6)).toBe(0n);
  });

  test("BPS constant is 10_000", () => {
    expect(BPS).toBe(10_000n);
  });
});
