"use client";

/**
 * Live quote panel.
 *
 * Driven by the parent's `useSpotQuote()` query. This component is
 * purely presentational + owns the TTL countdown — it does NOT trigger
 * its own refetch; the parent decides when to re-issue (e.g. 5s before
 * `expiresAt`, or when the input amount changes). Splitting the
 * countdown out keeps the parent re-render cheap (it doesn't tick at
 * 1Hz) while still surfacing the time-pressure to the user.
 */

import { useEffect, useState } from "react";

import { shortHash } from "@/lib/swap/explorer";
import type { SpotQuoteResponse } from "@/lib/swap/hooks";
import type { SpotPair } from "@/lib/swap/pairs";

interface QuoteStreamProps {
  pair: SpotPair;
  quote: SpotQuoteResponse | undefined;
  /** True while a fresh quote is in-flight. */
  isFetching: boolean;
  /** Error string from the last quote attempt, if any. */
  error: string | null;
  /** Decimal-amount-out the user requested as `minAmountOut`, in base units. */
  minAmountOut?: string;
}

export function QuoteStream({
  pair,
  quote,
  isFetching,
  error,
  minAmountOut,
}: QuoteStreamProps) {
  // 1Hz tick — exists only inside this component so the parent's
  // state machine doesn't re-render every second.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [quote]);

  if (error) {
    return (
      <div className="swap-quote-card swap-quote-card--error" role="status">
        <span className="swap-quote-label">Quote</span>
        <span className="swap-quote-error">{error}</span>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="swap-quote-card" role="status" aria-live="polite">
        <span className="swap-quote-label">Quote</span>
        <span className="swap-quote-placeholder">
          {isFetching ? "Fetching live quote…" : "Enter an amount to fetch a quote"}
        </span>
      </div>
    );
  }

  const remaining = Math.max(0, quote.expiresAt - now);
  const expiringSoon = remaining > 0 && remaining <= 5;
  const expired = remaining === 0;

  // Format the indicative price as "1 USDC ≈ X EURC" using the static
  // catalogue rate. The K3 API doesn't yet return a quoted price field;
  // when it does, replace `pair.indicativeRate` with that.
  const indicative = pair.indicativeRate.toFixed(4);

  return (
    <div
      className={
        "swap-quote-card" +
        (expiringSoon ? " swap-quote-card--soon" : "") +
        (expired ? " swap-quote-card--expired" : "")
      }
      role="status"
      aria-live="polite"
    >
      <div className="swap-quote-head">
        <span className="swap-quote-label">Live quote</span>
        <span
          className="swap-quote-ttl mono"
          aria-label={expired ? "Quote expired" : `Quote expires in ${remaining} seconds`}
        >
          {expired ? "expired" : `${remaining}s`}
        </span>
      </div>

      <dl className="swap-quote-grid">
        <div>
          <dt>Rate</dt>
          <dd className="mono">
            1 {pair.inputToken.asset} ≈ {indicative} {pair.outputToken.asset}
          </dd>
        </div>
        <div>
          <dt>Router</dt>
          <dd className="mono">{shortHash(quote.router)}</dd>
        </div>
        <div>
          <dt>Quote id</dt>
          <dd className="mono">{quote.quoteId.slice(0, 14)}…</dd>
        </div>
        <div>
          <dt>Min out</dt>
          <dd className="mono">
            {minAmountOut ?? "—"} {pair.outputToken.asset}
          </dd>
        </div>
      </dl>

      {isFetching && (
        <span className="swap-quote-refreshing" aria-live="off">
          refreshing…
        </span>
      )}
    </div>
  );
}
