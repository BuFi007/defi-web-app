/**
 * Formatting helpers shared by the uPlot wrappers in this folder.
 *
 * Wire-side bigints arrive as decimal strings or bigints (1e18-scaled).
 * uPlot wants plain `number[]` for both x and y. These helpers do the
 * lossy conversion in ONE place — never inline the math in components,
 * so we don't end up with two different rounding strategies between
 * the depth chart and the funding sparkline.
 *
 * Precision notes:
 *   - For depth (prices ~1.0–200, sizes ~0.001–10_000), the 1e15 ratio
 *     buys us ~3 decimals of integer headroom; lossy float is fine.
 *   - For funding rates (~1e-9 per second), the lossy conversion loses
 *     trailing precision but the chart pixels can't resolve below
 *     ~1e-6 anyway. Honest tradeoff.
 */

const E18 = 10n ** 18n;

/**
 * Convert a 1e18-scaled bigint (signed) into a lossy JS number. Mirrors
 * the helper inline'd in `use-funding-rate.ts` so we don't import from
 * a sibling perps hook here (keep the uplot dir self-contained).
 */
export function e18ToNumber(raw: bigint): number {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / E18;
  const frac = abs % E18;
  const value = Number(whole) + Number(frac) / Number(E18);
  return negative ? -value : value;
}

/** Accept either a string or bigint and normalise to number. */
export function e18LikeToNumber(raw: string | bigint | undefined | null): number {
  if (raw == null) return 0;
  if (typeof raw === "bigint") return e18ToNumber(raw);
  // The matcher serialises bigints as decimal strings ("-12345678…")
  // OR as 0x-prefixed hex when they come straight off a struct. Handle
  // both so the depth chart works against either source.
  try {
    return e18ToNumber(BigInt(raw));
  } catch {
    return 0;
  }
}

/**
 * Format a per-second funding rate for the sparkline tooltip line.
 * Annualizes (per Drift / dYdX conventions: rate * seconds-in-year * 100)
 * and tags ±. The result is already in % units.
 */
export function fmtAnnualizedPct(ratePerSec: number): string {
  if (!Number.isFinite(ratePerSec)) return "—";
  const annual = ratePerSec * 86_400 * 365 * 100;
  const sign = annual >= 0 ? "+" : "";
  return `${sign}${annual.toFixed(2)}% APY`;
}

/**
 * Pretty-print a price level at the precision the depth chart uses.
 * Mirrors the per-market rule in `panels.tsx`: <10 → 4 decimals,
 * <1000 → 2 decimals, otherwise 1. Centralised here so the depth
 * tooltip matches the orderbook card next to it.
 */
export function fmtPriceForDepth(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const decimals = price < 10 ? 4 : price < 1000 ? 2 : 1;
  return price.toFixed(decimals);
}

/** Compact size formatter — used by the depth-chart tooltip. */
export function fmtSizeForDepth(size: number): string {
  if (!Number.isFinite(size)) return "—";
  if (Math.abs(size) >= 1_000_000) return `${(size / 1_000_000).toFixed(2)}M`;
  if (Math.abs(size) >= 1_000) return `${(size / 1_000).toFixed(2)}k`;
  if (Math.abs(size) >= 1) return size.toFixed(2);
  return size.toFixed(4);
}
