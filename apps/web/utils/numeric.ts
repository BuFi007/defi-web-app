/**
 * Numeric input validation for user-facing trade/lending inputs.
 *
 * `parseFloat` is the wrong tool for trusted inputs into onchain math:
 *   - `parseFloat("Infinity")`         → Infinity  (would poison notional/liq math)
 *   - `parseFloat("1e308")`            → 1e308     (overflow → Infinity at multiply)
 *   - `parseFloat("-1.5")`             → -1.5      (negative sizes/prices never make sense)
 *   - `parseFloat("1.1234567890")`     → silently truncates downstream as toFixed
 *   - `parseFloat("12abc")`            → 12        (accepts garbage suffix)
 *
 * `parseFiniteDecimal` enforces:
 *   1. Non-empty trimmed string
 *   2. Strict decimal-only shape: digits, optional single dot, optional digits
 *   3. Parses to a finite, non-NaN number ≥ 0
 *   4. No more than `maxDecimals` digits after the decimal point
 *
 * Returns `null` on any violation so callers can disable submit / show errors
 * without throwing. We deliberately reject negatives (size/price are always
 * positive in this app — direction lives in side: long/short or buy/sell).
 */
export function parseFiniteDecimal(
  input: string,
  maxDecimals: number,
): number | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Reject scientific notation, signs, hex, whitespace inside, and any
  // non-decimal characters. Only allow `<digits>` or `<digits>.<digits>`
  // or `.<digits>`. We don't allow leading "+".
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;

  // Decimal-place cap. Treat values without a fractional part as 0 decimals.
  const dotIndex = trimmed.indexOf(".");
  const fractionLen = dotIndex === -1 ? 0 : trimmed.length - dotIndex - 1;
  if (fractionLen > maxDecimals) return null;

  const n = Number(trimmed);
  // Number() of the regex-validated shape can still surface Infinity for
  // absurdly long integer parts (e.g. "1" + "0".repeat(400)). Filter those.
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;

  return n;
}
