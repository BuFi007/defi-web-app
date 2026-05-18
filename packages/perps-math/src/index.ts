/**
 * @bufi/perps-math — pure, bigint-only math helpers for perps + lending UI.
 *
 * Every formula in this file is extracted verbatim from the inline math in
 * apps/web/components/trade-island/{panels,loan}.tsx. Semantics are
 * preserved; the only change is that money lives in bigint instead of
 * JavaScript floats so the UI no longer drifts at higher precision.
 *
 * Scales (kept consistent across the package):
 *   - USDC values: 1e6 atomic (`E6`)
 *   - Prices, sizes, funding rates: 1e18 (`WAD`)
 *   - Ratios / bps inputs: 1e4 (`BPS`)
 *   - Health factor output: 1e4 (`BPS`) so the UI can render `hf / 100`
 *
 * NB: `sizeUsdc` is the *notional* of the position in USDC atomic — i.e.
 * `quantity * price`. That matches `notional = sizeV * priceV` in the
 * legacy inline math (where `sizeV` was already USDC-denominated).
 */

export * from "./decimal";

import { BPS, WAD, absBig, divWad, mulWad, usdcToWad, wadToUsdc } from "./decimal";

export type PerpSide = "long" | "short";

// The legacy inline formula uses 0.8 as the buffer:
//   liqLong  = price * (1 - 0.8 / lev)
//   liqShort = price * (1 + 0.8 / lev)
// i.e. you're liquidated when you lose 80% of posted margin. Expressed
// in bps for the public API.
export const DEFAULT_MAINTENANCE_LOSS_BPS = 8_000;

/**
 * Initial margin = notional / leverage. Mirrors the inline:
 *   const reqMargin = notional / lev;
 */
export function calculateInitialMargin(sizeUsdc: bigint, leverage: number): bigint {
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error("calculateInitialMargin: leverage must be > 0");
  }
  if (sizeUsdc < 0n) throw new Error("calculateInitialMargin: sizeUsdc must be >= 0");
  // Round leverage to integer bps so the division stays bigint-clean.
  const levBps = BigInt(Math.round(leverage * Number(BPS)));
  if (levBps === 0n) throw new Error("calculateInitialMargin: leverage rounded to 0");
  return (sizeUsdc * BPS) / levBps;
}

/**
 * Maintenance margin = notional * maintenanceRatioBps / 10_000.
 * Not directly used by the legacy inline math (it folded it into the liq
 * formula) but exposed so the data tab can render the requirement.
 */
export function calculateMaintenanceMargin(sizeUsdc: bigint, maintenanceRatioBps: number): bigint {
  if (sizeUsdc < 0n) throw new Error("calculateMaintenanceMargin: sizeUsdc must be >= 0");
  if (maintenanceRatioBps < 0) throw new Error("calculateMaintenanceMargin: ratio must be >= 0");
  return (sizeUsdc * BigInt(maintenanceRatioBps)) / BPS;
}

/**
 * Liquidation price. Faithful port of the inline formula:
 *   liqLong  = entry * (1 - 0.8 / lev)
 *   liqShort = entry * (1 + 0.8 / lev)
 * Generalised so callers can pass `marginE6` + `sizeE18` directly (instead
 * of leverage) for positions where the actual posted margin diverges from
 * `notional / lev` (e.g. cross-margin top-ups).
 *
 * Derivation: at liquidation, loss = margin * maintLossBps/BPS, and
 *   loss = sizeE18 * |entry - liq| / WAD
 * so:
 *   priceDelta = margin * maintLossBps / (BPS * sizeE18 / WAD)
 *
 * Returns a 1e18-scale price; never negative (clamped at 0 for over-levered
 * shorts).
 */
export function calculateLiquidationPrice(args: {
  entryPriceE18: bigint;
  sizeE18: bigint;
  marginE6: bigint;
  side: PerpSide;
  maintenanceLossBps?: number;
}): bigint {
  const { entryPriceE18, sizeE18, marginE6, side } = args;
  const maintenanceLossBps = args.maintenanceLossBps ?? DEFAULT_MAINTENANCE_LOSS_BPS;
  if (entryPriceE18 < 0n) throw new Error("calculateLiquidationPrice: entryPrice must be >= 0");
  if (sizeE18 <= 0n) return entryPriceE18; // no exposure → liq stays at entry
  if (marginE6 < 0n) throw new Error("calculateLiquidationPrice: margin must be >= 0");

  const marginWad = usdcToWad(marginE6);
  const allowedLossWad = (marginWad * BigInt(maintenanceLossBps)) / BPS;
  // priceDelta = allowedLossWad / sizeE18, but we need the result in WAD
  // (1e18 price scale). sizeE18 is already 1e18, allowedLossWad is 1e18
  // dollars — so priceDelta = allowedLossWad * WAD / sizeE18.
  const priceDeltaWad = (allowedLossWad * WAD) / sizeE18;
  if (side === "long") {
    return entryPriceE18 > priceDeltaWad ? entryPriceE18 - priceDeltaWad : 0n;
  }
  return entryPriceE18 + priceDeltaWad;
}

/**
 * Unrealised PnL in USDC atomic. Long: (mark - entry) * size; short flipped.
 * Returns signed bigint (negative = underwater).
 */
export function calculateUnrealizedPnl(args: {
  entryPriceE18: bigint;
  markPriceE18: bigint;
  sizeE18: bigint;
  side: PerpSide;
}): bigint {
  const { entryPriceE18, markPriceE18, sizeE18, side } = args;
  if (sizeE18 < 0n) throw new Error("calculateUnrealizedPnl: size must be >= 0 (use side flag)");
  if (sizeE18 === 0n) return 0n;
  const delta = side === "long" ? markPriceE18 - entryPriceE18 : entryPriceE18 - markPriceE18;
  // pnl_wad = delta_wad * size_wad / WAD
  const pnlWad = mulWad(delta, sizeE18);
  // Convert WAD-USD to USDC atomic (1e6).
  return wadToUsdc(pnlWad);
}

/**
 * Funding payment over `intervalSeconds`. fundingRateE18 is a *per-second*
 * rate (Pyth convention used by the matcher keeper). Positive payment means
 * the long pays the short.
 */
export function calculateFundingPayment(args: {
  sizeE18: bigint;
  fundingRateE18: bigint;
  intervalSeconds: number;
}): bigint {
  const { sizeE18, fundingRateE18, intervalSeconds } = args;
  if (sizeE18 < 0n) throw new Error("calculateFundingPayment: size must be >= 0");
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
    throw new Error("calculateFundingPayment: intervalSeconds must be a finite non-negative number");
  }
  if (sizeE18 === 0n || intervalSeconds === 0) return 0n;
  const payment = mulWad(sizeE18, fundingRateE18) * BigInt(Math.round(intervalSeconds));
  return wadToUsdc(payment);
}

/**
 * Maximum leverage for a market, sourced from `maxLeverageBps` (the chain
 * stores leverage caps in bps so e.g. 25x = 250_000). Returns a JS number
 * because every consumer (Slider, presets) needs a `number`.
 */
export function calculateMaxLeverage(market: { maxLeverageBps: number }): number {
  if (!Number.isFinite(market.maxLeverageBps) || market.maxLeverageBps <= 0) {
    throw new Error("calculateMaxLeverage: maxLeverageBps must be > 0");
  }
  return market.maxLeverageBps / Number(BPS);
}

/**
 * Health factor at 1e4 scale (so the UI can do `hf / 100` to render percent).
 * HF = collateralValue * liquidationLtv / borrowedValue.
 *
 *   - collateralValueE18: collateral mark-to-market in USD WAD
 *   - borrowedValueE18: outstanding debt in USD WAD
 *   - liquidationLtvBps: e.g. 8_600 for 86% LLTV
 *
 * Returns MAX_UINT_64 as a sentinel for "no debt" (matches the Morpho
 * convention surfaced via @/lib/telarana/health). Caller is free to clamp.
 */
export const HEALTH_FACTOR_INFINITY = (1n << 64n) - 1n;

export function calculateHealthFactor(args: {
  collateralValueE18: bigint;
  borrowedValueE18: bigint;
  liquidationLtvBps: number;
}): bigint {
  const { collateralValueE18, borrowedValueE18, liquidationLtvBps } = args;
  if (collateralValueE18 < 0n) throw new Error("calculateHealthFactor: collateral must be >= 0");
  if (borrowedValueE18 < 0n) throw new Error("calculateHealthFactor: borrowed must be >= 0");
  if (liquidationLtvBps < 0) throw new Error("calculateHealthFactor: lltv must be >= 0");
  if (borrowedValueE18 === 0n) return HEALTH_FACTOR_INFINITY;
  // hf_bps = (collateral * lltvBps / borrowed) — already scaled to 1e4.
  return (collateralValueE18 * BigInt(liquidationLtvBps)) / borrowedValueE18;
}

/**
 * Slippage in bps between an expected price and the realised fill price.
 * Always returned as a non-negative bps figure — direction is implicit in
 * the order side.
 */
export function calculateSlippage(args: { expectedPriceE18: bigint; fillPriceE18: bigint }): bigint {
  const { expectedPriceE18, fillPriceE18 } = args;
  if (expectedPriceE18 <= 0n) {
    throw new Error("calculateSlippage: expectedPrice must be > 0");
  }
  const delta = absBig(fillPriceE18 - expectedPriceE18);
  // (delta / expected) in bps = delta * 10_000 / expected
  return (delta * BPS) / expectedPriceE18;
}

/**
 * Price impact in bps as a function of trade size vs orderbook depth. Naive
 * linear model that matches the placeholder math the orderbook card shows —
 * good enough for the UI hint, the real keeper uses on-chain depth.
 */
export function calculatePriceImpact(args: { sizeE18: bigint; depthE18: bigint }): bigint {
  const { sizeE18, depthE18 } = args;
  if (sizeE18 < 0n) throw new Error("calculatePriceImpact: size must be >= 0");
  if (depthE18 <= 0n) throw new Error("calculatePriceImpact: depth must be > 0");
  if (sizeE18 === 0n) return 0n;
  return (sizeE18 * BPS) / depthE18;
}

// ────────────────────────── number-domain helpers ──────────────────────────
// The legacy UI binds floats to its <input>s. These tiny wrappers preserve
// the existing function signatures used inside the panels so we can call
// the new helpers without restructuring the React tree. They are *thin*
// shims — every penny of money math still happens in bigint above.

/** Float wrapper around calculateInitialMargin for the order panel UI. */
export function requiredMarginFloat(notionalUsd: number, leverage: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd < 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  // Round notional into 1e6 atomic so bigint math stays exact for typical
  // dollar amounts.
  const sizeUsdc = BigInt(Math.round(notionalUsd * Number(10n ** 6n)));
  const margin = calculateInitialMargin(sizeUsdc, leverage);
  return Number(margin) / Number(10n ** 6n);
}

/** Float wrapper around calculateLiquidationPrice for the order panel UI. */
export function liquidationPriceFloat(args: {
  entryPrice: number;
  notionalUsd: number;
  leverage: number;
  side: PerpSide;
  maintenanceLossBps?: number;
}): number {
  const { entryPrice, notionalUsd, leverage, side } = args;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return entryPrice;
  if (!Number.isFinite(leverage) || leverage <= 0) return entryPrice;
  // Derive sizeE18 from notional/entry — sizeE18 is the *quantity* of the
  // base asset, not the dollar notional. This matches the inline math: the
  // 0.8/lev factor cancels regardless of size, so any positive size works,
  // but we use the real quantity so the helper composes with later calls
  // that need it (e.g. pnl).
  const sizeE18 = BigInt(Math.round((notionalUsd / entryPrice) * 1e18));
  const entryPriceE18 = BigInt(Math.round(entryPrice * 1e18));
  const marginUsd = notionalUsd / leverage;
  const marginE6 = BigInt(Math.round(marginUsd * 1e6));
  const liqE18 = calculateLiquidationPrice({
    entryPriceE18,
    sizeE18,
    marginE6,
    side,
    maintenanceLossBps: args.maintenanceLossBps,
  });
  return Number(liqE18) / 1e18;
}
