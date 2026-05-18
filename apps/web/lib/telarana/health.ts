/**
 * Health-factor + monetary formatting helpers for the LoanTab UI.
 *
 * The SDK reports health factors at 1e18 scale (Morpho convention). The UI
 * wants human-readable strings and risk-bucket colors.
 */

export type HealthBucket = "safe" | "watch" | "danger" | "liquidatable" | "none";

const WAD = 10n ** 18n;

export function healthFactorFromE18(raw: bigint | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const big = typeof raw === "bigint" ? raw : BigInt(raw);
  // MAX_UINT_256 is the "no debt" sentinel; surface as +Infinity for UI math.
  const MAX = (1n << 256n) - 1n;
  if (big === MAX) return Number.POSITIVE_INFINITY;
  return Number(big) / Number(WAD);
}

export function formatHealthFactor(hf: number | null | undefined): string {
  if (hf === null || hf === undefined) return "—";
  if (!Number.isFinite(hf)) return "∞";
  if (hf >= 100) return hf.toFixed(0);
  return hf.toFixed(2);
}

export function healthBucket(hf: number | null | undefined): HealthBucket {
  if (hf === null || hf === undefined) return "none";
  if (!Number.isFinite(hf)) return "safe";
  if (hf < 1) return "liquidatable";
  if (hf < 1.1) return "danger";
  if (hf < 1.4) return "watch";
  return "safe";
}

export function formatAmount(units: bigint | string | null | undefined, decimals: number): number {
  if (units === null || units === undefined) return 0;
  const big = typeof units === "bigint" ? units : BigInt(units);
  if (decimals <= 0) return Number(big);
  const divisor = 10n ** BigInt(decimals);
  const whole = big / divisor;
  const frac = big % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}

export function toAtomic(amount: string | number, decimals: number): bigint {
  const str = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!str) return 0n;
  const [whole, fracRaw = ""] = str.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const wholeBig = BigInt(whole || "0");
  const fracBig = frac ? BigInt(frac) : 0n;
  return wholeBig * 10n ** BigInt(decimals) + fracBig;
}
