"use client";

/**
 * Funding-rate live tick widget.
 *
 * Shows:
 *   - Current funding rate (per-8h fmt, signed, with direction tag)
 *   - Annualized rate as a secondary read
 *   - Last-poke countdown ("Δ 12s ago")
 *
 * Sparkline is intentionally NOT rendered in this first cut. The brief
 * lists it as optional and requires a Ponder-side `FundingPoked` history
 * endpoint that doesn't exist yet (see Stop-condition in the brief). We
 * leave a hook-shaped placeholder div with an explanatory tooltip so
 * the layout doesn't shift when the data lands.
 *
 * Refresh: relies on `useFundingRate`'s 30-second poll. A separate
 * 1-second `tick` interval drives the "ago Ns" display without
 * triggering RPC fetches.
 */

import { useEffect, useState } from "react";

import { Hint } from "./hint";
import { useFundingRate } from "@/lib/perps/use-funding-rate";
import type { PerpsChainId } from "@/lib/perps/chains";
import { PERPS_CHAIN_BY_ID } from "@/lib/perps/chains";
import type { Hex } from "viem";

interface FundingRateWidgetProps {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
}

export function FundingRateWidget({ chainId, marketId }: FundingRateWidgetProps) {
  const chain = PERPS_CHAIN_BY_ID[chainId];
  const funding = useFundingRate({ chainId, marketId });
  // Drives the "ago Ns" countdown without thrashing the wagmi cache.
  const [tickNow, setTickNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setTickNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const live = funding.data;
  const ageSec = live ? Math.max(0, tickNow - live.lastUpdateSec) : null;
  const direction = live?.isBalanced
    ? "Balanced"
    : live?.longsPay
      ? "Longs pay"
      : "Shorts pay";
  const tone = !live || live.isBalanced ? "neutral" : live.longsPay ? "loss" : "profit";

  if (!chain?.enabled) {
    return (
      <div
        className="card funding-rate-widget"
        aria-disabled="true"
        style={{ padding: 10 }}
      >
        <div className="muted" style={{ fontSize: 11 }}>
          Funding data unavailable: {chain?.pendingReason ?? "perps not live on this chain"}.
        </div>
      </div>
    );
  }

  return (
    <div
      className="card funding-rate-widget"
      style={{
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="frw-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-3)", letterSpacing: 0.4 }}>
          FUNDING <Hint w={280}>Rate paid between longs and shorts each block, scaled here to the 8-hour epoch.</Hint>
        </span>
        <span
          className={"pill " + (tone === "profit" ? "profit" : tone === "loss" ? "loss" : "muted")}
          style={{ fontSize: 9.5 }}
        >
          {direction}
        </span>
      </div>

      <div
        className="frw-rates"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 18,
            fontWeight: 800,
            color:
              tone === "profit"
                ? "var(--profit-ink)"
                : tone === "loss"
                  ? "var(--loss-ink)"
                  : "var(--ink)",
          }}
        >
          {live
            ? `${live.per8hPct >= 0 ? "+" : ""}${live.per8hPct.toFixed(4)}%`
            : funding.readFailed
              ? "n/a"
              : "—"}
          <span
            className="muted"
            style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 4 }}
          >
            / 8h
          </span>
        </span>
        <span
          className="mono muted"
          style={{ fontSize: 11, fontWeight: 700 }}
          title="Annualised — `rate * 86400 * 365`"
        >
          {live
            ? `${live.annualizedPct >= 0 ? "+" : ""}${live.annualizedPct.toFixed(2)}% APY`
            : ""}
        </span>
      </div>

      <div
        className="frw-meta"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "var(--ink-3)",
          fontWeight: 700,
        }}
      >
        <span>
          Last poke{" "}
          <span className="mono">
            {ageSec == null ? "—" : `${ageSec}s ago`}
          </span>
        </span>
        <span className="mono">v{live?.version ?? 0}</span>
      </div>

      {/* Sparkline placeholder — wires up once Ponder indexes
          FundingPoked history (brief Stop-condition #3 — TODO). */}
      <div
        className="frw-spark-placeholder"
        title="24h funding sparkline coming once Ponder exposes a FundingPoked history endpoint."
        style={{
          marginTop: 2,
          height: 24,
          borderRadius: 6,
          background:
            "repeating-linear-gradient(90deg, var(--surface-2) 0, var(--surface-2) 4px, transparent 4px, transparent 8px)",
          opacity: 0.35,
        }}
        aria-hidden="true"
      />
    </div>
  );
}
