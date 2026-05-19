"use client";

import NumberFlow from "@number-flow/react";

type Props = {
  value: number;
  /**
   * Currency code for `Intl.NumberFormat`, or `"%"` for percent, or null
   * to render a plain number (no prefix/suffix). Defaults to "USD".
   */
  currency?: string | null;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /**
   * Intl notation. Pass `"compact"` to get "10M" / "1.2B" instead of
   * "10,000,000" / "1,200,000,000" — important for narrow slots like
   * the loan-row balance column, where a 7-figure balance would push
   * the hub label out of view.
   */
  notation?: "standard" | "compact";
  locale?: string;
  className?: string;
  /** Optional trailing label (e.g. token symbol) rendered as a sibling. */
  suffix?: string;
  /** Optional leading label (e.g. "≈ "). */
  prefix?: string;
};

/**
 * Animated number with smooth digit transitions powered by `@number-flow/react`.
 * Ported from desk-v1/apps/app/src/components/animated-number — kept
 * stateless so a parent can drive it with whatever live source (RPC
 * read, websocket tick, react-query cache) it owns.
 *
 * Use this everywhere a value can change while the user is looking at
 * it: wallet totals, market APYs, position balances, fill prices.
 * Don't use it for static-once render (settings labels, addresses).
 */
export function AnimatedNumber({
  value,
  currency = "USD",
  minimumFractionDigits,
  maximumFractionDigits,
  notation,
  locale,
  className,
  suffix,
  prefix,
}: Props) {
  const localeToUse = locale && locale.trim() !== "" ? locale : "en-US";
  const safeValue = Number.isFinite(value) ? value : 0;

  let format: Intl.NumberFormatOptions;
  if (currency === "%") {
    format = {
      style: "percent",
      minimumFractionDigits,
      maximumFractionDigits,
      notation,
    };
  } else if (currency == null) {
    format = {
      minimumFractionDigits,
      maximumFractionDigits,
      notation,
    };
  } else {
    format = {
      style: "currency",
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
      notation,
    };
  }

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      {prefix && <span>{prefix}</span>}
      {/* NumberFlow's `Format` type narrows `notation` to "standard"|"compact"
          while Intl.NumberFormatOptions also accepts "scientific"|"engineering".
          We never pass the wider values, so the cast is sound — and TS5 won't
          accept a structural-subtype assignment without it. */}
      <NumberFlow
        value={currency === "%" ? safeValue / 100 : safeValue}
        format={format as React.ComponentProps<typeof NumberFlow>["format"]}
        locales={localeToUse}
        willChange
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
