/**
 * Health-factor band classifier for perps positions.
 *
 * Mirrors the lending-side `lib/telarana/health.ts` API but for perps:
 *  - input is the `ratioBps` returned by `FxHealthChecker.healthFactor`
 *    (1.0 = 10000 bps)
 *  - output is one of four bands the UI uses to tint position rows:
 *      safe  (HF >= 1.4)              — no label, neutral tint
 *      watch (1.1 <= HF < 1.4)        — yellow tint
 *      danger (1.0 <= HF < 1.1)       — orange tint
 *      imminent (HF < 1.0)            — red tint, pulsing
 *
 * Centralized so position rows, individual cards, and any future widget
 * all band consistently. The bands intentionally mirror the lending HF
 * ladder one step tighter (lending uses safe/watch/danger/liquidatable);
 * the perps wording "imminent" matches the FxLiquidationEngine semantics —
 * once HF < 1 the position is liquidatable but not yet liquidated, and the
 * trader still has the flag-delay window to act.
 */

export type PerpsHealthBand = "safe" | "watch" | "danger" | "imminent" | "none";

const BPS_PER_UNIT = 10_000;

export interface PerpsHealthBandResult {
  band: PerpsHealthBand;
  /** Decimal health factor (1.0 = boundary). `null` when input is unknown. */
  hf: number | null;
  /** Short label for chip/badge. Empty string for "safe" + "none". */
  label: string;
  /** Whether the row should pulse to draw the eye (imminent only). */
  pulse: boolean;
}

/**
 * Convert the on-chain `ratioBps` (1e4 scale) into a decimal HF.
 * Accepts bigint (raw read), string (serialized RPC), or number (already
 * decoded). Returns `null` when input is missing or unparseable.
 */
export function healthFactorFromBps(
  raw: bigint | string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return raw / BPS_PER_UNIT;
  }
  try {
    const big = typeof raw === "bigint" ? raw : BigInt(raw);
    // ratioBps is unbounded above for accounts with no debt; coerce overflow
    // to +Infinity so the band classifier short-circuits to "safe".
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return Number.POSITIVE_INFINITY;
    return Number(big) / BPS_PER_UNIT;
  } catch {
    return null;
  }
}

export function classifyHealthBand(
  hf: number | null | undefined,
): PerpsHealthBandResult {
  if (hf === null || hf === undefined) {
    return { band: "none", hf: null, label: "", pulse: false };
  }
  if (!Number.isFinite(hf)) {
    return { band: "safe", hf, label: "", pulse: false };
  }
  if (hf < 1.0) {
    return { band: "imminent", hf, label: "imminent", pulse: true };
  }
  if (hf < 1.1) {
    return { band: "danger", hf, label: "danger", pulse: false };
  }
  if (hf < 1.4) {
    return { band: "watch", hf, label: "watch", pulse: false };
  }
  return { band: "safe", hf, label: "", pulse: false };
}

/**
 * Convenience hook-shaped helper: accept the raw bps reading and get the
 * classified band in one call. Not a React hook, just a derive. Naming
 * matches the brief's `useHealthBand(hf)` request — keeping it as a pure
 * function avoids force-binding rules-of-hooks for what is really just a
 * lookup table.
 */
export function useHealthBand(
  hf: number | null | undefined,
): PerpsHealthBandResult {
  return classifyHealthBand(hf);
}

/**
 * Format the HF for display. Returns "—" for null and "∞" for +Inf so the
 * "no debt" case reads cleanly. Otherwise two decimals — matches the
 * lending-side formatter so the two surfaces look identical.
 */
export function formatHealthFactor(hf: number | null | undefined): string {
  if (hf === null || hf === undefined) return "—";
  if (!Number.isFinite(hf)) return "∞";
  if (hf >= 100) return hf.toFixed(0);
  return hf.toFixed(2);
}
