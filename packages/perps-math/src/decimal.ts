/**
 * Bigint helpers for UI-boundary conversions.
 *
 * Perps math is bigint-only internally. These helpers exist to translate
 * decimal strings (typed into the order form) into fixed-point bigints, and
 * back to strings for display. No floats touch money.
 *
 * We deliberately avoid pulling in viem or decimal.js here so this package
 * is dependency-free (faster install, smaller bundle, no version drift).
 */

/** USDC atomic scale (6 dp on Arc and every chain we settle on). */
export const USDC_DECIMALS = 6 as const;
/** WAD = 1e18, the canonical price + size scale used by Pyth + Morpho. */
export const WAD = 10n ** 18n;
/** 1e6, used to scale USDC margin/notional into bigint. */
export const E6 = 10n ** 6n;
/** Basis points denominator (100% = 10_000 bps). */
export const BPS = 10_000n;

/**
 * Parse a human decimal string ("12.345") into a fixed-point bigint with the
 * given number of decimals. Strips a leading sign, ignores trailing precision
 * beyond `decimals`. Empty / non-numeric inputs return 0n so the UI doesn't
 * have to special-case the empty input.
 */
export function parseUnits(value: string | number | null | undefined, decimals: number): bigint {
  if (value === null || value === undefined) return 0n;
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (!raw) return 0n;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole = "", fracRaw = ""] = body.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const wholeDigits = whole.replace(/[^0-9]/g, "") || "0";
  const fracDigits = frac.replace(/[^0-9]/g, "");
  const result = BigInt(wholeDigits) * 10n ** BigInt(decimals) + BigInt(fracDigits || "0");
  return negative ? -result : result;
}

/**
 * Format a fixed-point bigint as a decimal string. Mirrors viem.formatUnits
 * semantics: keeps the sign, trims trailing zeros from the fraction (but
 * never the leading "0." so consumers can parseFloat the result safely).
 */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  if (decimals === 0) return negative ? `-${whole.toString()}` : whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Convert a USDC atomic bigint into a 1e18-scaled bigint for cross-scale math. */
export function usdcToWad(usdcAtomic: bigint): bigint {
  return usdcAtomic * 10n ** BigInt(18 - USDC_DECIMALS);
}

/** Convert a WAD bigint back into USDC atomic (truncated, not rounded). */
export function wadToUsdc(wad: bigint): bigint {
  return wad / 10n ** BigInt(18 - USDC_DECIMALS);
}

/** Multiply two WAD-scaled bigints and rescale back to WAD. */
export function mulWad(a: bigint, b: bigint): bigint {
  return (a * b) / WAD;
}

/** Divide two WAD-scaled bigints and keep the WAD scale. */
export function divWad(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("divWad: division by zero");
  return (a * WAD) / b;
}

/** Absolute value for bigint. */
export function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}
