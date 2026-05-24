"use client";

/**
 * Funding-rate live tick widget.
 *
 * Shows:
 *   - Current funding rate (per-8h fmt, signed, with direction tag)
 *   - Annualized rate as a secondary read
 *   - Last-poke countdown ("Δ 12s ago")
 *   - <FundingSparkline /> — a uPlot pure-curve sparkline of the
 *     accumulated funding-rate history. Color-shifts on the LATEST
 *     rate's sign (positive → loss-ink, negative → profit-ink,
 *     balanced → muted), matching the "longs pay / shorts pay" pill.
 *
 * The sparkline data source is `useFundingHistory` — see that hook
 * for the analytics → WS → in-memory accumulator fallback chain. The
 * 30-s `useFundingRate` poll keeps the accumulator fresh.
 */

import { useEffect, useMemo, useState } from "react";
import { type AlignedData, type Options } from "uplot";

import { Hint } from "./hint";
import { useFundingRate } from "@/lib/perps/use-funding-rate";
import { useFundingHistory } from "@/lib/perps/use-funding-history";
// Barrel import — also pulls in `uplot.css` for the sparkline.
import { useUplot, fmtAnnualizedPct } from "@/lib/perps/uplot";
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

      <FundingSparkline chainId={chainId} marketId={marketId} tone={tone} />
    </div>
  );
}

interface FundingSparklineProps {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
  tone: "profit" | "loss" | "neutral";
}

/**
 * Pure-curve uPlot sparkline of the funding-rate history. No axes, no
 * legend, no markers — just the curve in the tone color of the latest
 * sample. Renders a striped placeholder until the accumulator has at
 * least 2 samples (one tick after mount).
 *
 * Memoised independently from the parent widget so the 1-second "ago Ns"
 * tick doesn't cause uPlot to re-render its data — the chart only
 * updates when a new funding-rate snapshot lands.
 */
function FundingSparkline({ chainId, marketId, tone }: FundingSparklineProps) {
  const { points, isWarmingUp, source } = useFundingHistory({ chainId, marketId });

  const accent = useMemo(() => {
    // Read the active theme color synchronously from the cascade. We
    // rebuild the opts when `tone` changes so the stroke updates with
    // every flip.
    if (typeof window === "undefined") {
      return tone === "loss" ? "#ef4444" : tone === "profit" ? "#22c55e" : "#9aa0a6";
    }
    const styles = getComputedStyle(document.documentElement);
    if (tone === "loss") return styles.getPropertyValue("--loss-ink").trim() || "#ef4444";
    if (tone === "profit") return styles.getPropertyValue("--profit-ink").trim() || "#22c55e";
    return styles.getPropertyValue("--ink-3").trim() || "#9aa0a6";
  }, [tone]);

  const data = useMemo<AlignedData>(() => {
    if (points.length < 2) return [[], []] as unknown as AlignedData;
    const xs = points.map((p) => p.timestamp);
    const ys = points.map((p) => p.ratePerSec);
    return [xs, ys] as unknown as AlignedData;
  }, [points]);

  const opts = useMemo<Options>(
    () => ({
      width: 200,
      height: 24,
      // No padding — the sparkline runs edge-to-edge.
      padding: [2, 2, 2, 2],
      legend: { show: false },
      cursor: { show: false },
      // SAFETY: a sparkline that's a single horizontal line should still
      // paint — without auto, uPlot snaps Y to (-1,1) and clips a flat
      // rate to the bottom edge.
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        { show: false },
        { show: false },
      ],
      series: [
        {},
        {
          stroke: accent,
          width: 1.5,
          // No fill — keeps the sparkline weightless next to the rate
          // number. The widget already has a `tone`-tinted big number;
          // doubling that as a filled area reads as noise.
          fill: undefined,
          points: { show: false },
          value: (_self, raw) =>
            raw == null || Number.isNaN(raw) ? "—" : fmtAnnualizedPct(raw),
        },
      ],
    }),
    [accent],
  );

  // Re-keying the lifecycle when the accent changes IS the right call
  // here — a 24-px-tall, 2-series chart costs <1 ms to rebuild and the
  // alternative is mutating series internals, which is fragile for a
  // sparkline that's already cheap to redraw.
  const optsKey = `funding-spark-${accent}`;
  const { containerRef } = useUplot({ opts, data, optsKey });

  const empty = isWarmingUp;
  const titleSrc =
    source === "analytics"
      ? "From Tinybird funding-history pipe"
      : source === "ws"
        ? "From live funding WS channel"
        : source === "memory"
          ? "Accumulated in this session from on-chain reads"
          : "Sparkline warms up after the next funding poke";

  return (
    <div
      className="uplot-spark frw-spark"
      title={titleSrc}
      style={{
        marginTop: 2,
        position: "relative",
        height: 24,
      }}
    >
      {empty && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 6,
            background:
              "repeating-linear-gradient(90deg, var(--surface-2) 0, var(--surface-2) 4px, transparent 4px, transparent 8px)",
            opacity: 0.35,
          }}
        />
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", opacity: empty ? 0 : 1 }}
        aria-label="Funding-rate sparkline"
      />
    </div>
  );
}
