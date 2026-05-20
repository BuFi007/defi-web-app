"use client";

/**
 * Cumulative-depth chart.
 *
 * Renders the pending-intents book as a side-by-side staircase: bids on
 * the left in `--profit-ink`, asks on the right in `--loss-ink`. The
 * Y axis is cumulative size from best price outwards.
 *
 * Data sources, in priority order:
 *   1. `useLiveMarket(marketSym).obDelta` — the live `obDelta` events
 *      pushed over the `/ws/markets/:marketSym` channel by `@bufi/api`.
 *      These ARE book snapshots, despite the "delta" name — see
 *      `apps/api/src/routes/ws.ts` and PR #56's wire contract.
 *   2. `usePendingIntents(marketIdHex)` — the REST-poll fallback (5s)
 *      used by `OrderbookCard`. Always firing in the background so
 *      the chart paints data within a tick of mount even when the WS
 *      hasn't pushed a frame yet.
 *
 * The depth chart NEVER blocks waiting for the WS — REST data lands
 * within ~3s of mount under normal conditions and the WS upgrades the
 * stream when its first frame arrives.
 *
 * Brief stop-condition note: `useOrderbookStream(marketId)` from PR #56
 * does not exist on `feat/wk1d3-multichain-perps` yet (no
 * `apps/web/lib/perps/use-orderbook-stream.ts`). We use the existing
 * `useLiveMarket().obDelta` channel, which IS publishing depth deltas
 * via Pyth Hermes today, plus the REST fallback for cold-start.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";

import { useUplot } from "@/lib/perps/uplot";
import "@/lib/perps/uplot"; // CSS side-effect — the index barrel imports uplot.css
import {
  fmtPriceForDepth,
  fmtSizeForDepth,
} from "@/lib/perps/uplot/format";
import { useLiveMarket } from "@/lib/perps/use-live-market";
import { usePendingIntents } from "@/lib/perps/use-pending-intents";

export interface DepthChartProps {
  /**
   * Market symbol the live WS keys off — same value as `market.sym`
   * from `data.tsx` (e.g. `"EUR/USD"`). The WS hub uses symbols, not
   * marketId hex, because Hermes is keyed by symbol upstream.
   */
  marketSym: string;
  /**
   * Hex marketId used by the REST `/perps/intents/pending` fallback.
   * Optional — when absent, the chart only renders once the WS
   * publishes a frame.
   */
  marketId?: string;
  /** Pixel height of the chart container. Defaults to 120. */
  height?: number;
}

interface DepthSnapshot {
  /** Best bid price, lossy float. */
  bestBid: number | null;
  /** Best ask price, lossy float. */
  bestAsk: number | null;
  /** Bids sorted descending, with cumulative size. */
  bids: Array<{ price: number; cum: number }>;
  /** Asks sorted ascending, with cumulative size. */
  asks: Array<{ price: number; cum: number }>;
}

const EMPTY_SNAPSHOT: DepthSnapshot = {
  bestBid: null,
  bestAsk: null,
  bids: [],
  asks: [],
};

/**
 * Walk descending bids / ascending asks from the spread outwards and
 * accumulate size. Returns the snapshot uPlot eventually consumes.
 */
function buildSnapshot(
  bids: Array<{ price: number; size: number }>,
  asks: Array<{ price: number; size: number }>,
): DepthSnapshot {
  if (bids.length === 0 && asks.length === 0) return EMPTY_SNAPSHOT;

  // Sort defensively — the matcher already returns best-first, but a
  // WS snapshot off an upstream rebuild can be in any order.
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

  let bidCum = 0;
  const bidsCum = sortedBids.map((b) => {
    bidCum += b.size;
    return { price: b.price, cum: bidCum };
  });
  let askCum = 0;
  const asksCum = sortedAsks.map((a) => {
    askCum += a.size;
    return { price: a.price, cum: askCum };
  });

  return {
    bestBid: sortedBids[0]?.price ?? null,
    bestAsk: sortedAsks[0]?.price ?? null,
    bids: bidsCum,
    asks: asksCum,
  };
}

/**
 * Read the active theme's profit / loss accent colors from CSS vars so
 * the depth chart matches the rest of the trade tab. Reads happen ONCE
 * per mount + on the `theme-change` synthetic event that the spaceman
 * theme provider dispatches (see apps/web/components/theme-provider).
 */
function useAccentColors(): { profit: string; loss: string; ink3: string } {
  const [colors, setColors] = useState(() => ({
    // SSR-safe defaults — overridden on mount.
    profit: "#22c55e",
    loss: "#ef4444",
    ink3: "#9aa0a6",
  }));
  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement);
      const profit = styles.getPropertyValue("--profit-ink").trim() || "#22c55e";
      const loss = styles.getPropertyValue("--loss-ink").trim() || "#ef4444";
      const ink3 = styles.getPropertyValue("--ink-3").trim() || "#9aa0a6";
      setColors({ profit, loss, ink3 });
    };
    read();
    // Theme-toggle dispatches a `theme-change` CustomEvent (see
    // theme-provider.tsx). Re-reading on that fires keeps the chart
    // accents in sync with light/dark/spaceman/ghost switches.
    window.addEventListener("theme-change", read);
    return () => window.removeEventListener("theme-change", read);
  }, []);
  return colors;
}

export function DepthChart({ marketSym, marketId, height = 120 }: DepthChartProps) {
  const live = useLiveMarket(marketSym);
  const pending = usePendingIntents(marketId);
  const accents = useAccentColors();

  // The two streams might both produce frames within the same render
  // tick; we always prefer the WS payload when it has data, but fall
  // back to REST when the WS hasn't pushed yet.
  const snapshot = useMemo<DepthSnapshot>(() => {
    if (live.obDelta && (live.obDelta.bids.length > 0 || live.obDelta.asks.length > 0)) {
      return buildSnapshot(live.obDelta.bids, live.obDelta.asks);
    }
    if (pending.data && (pending.data.bids.length > 0 || pending.data.asks.length > 0)) {
      return buildSnapshot(
        pending.data.bids.map((b) => ({ price: b.price, size: b.size })),
        pending.data.asks.map((a) => ({ price: a.price, size: a.size })),
      );
    }
    return EMPTY_SNAPSHOT;
  }, [live.obDelta, pending.data]);

  // Aligned data for uPlot. The x-axis is a unified price ladder
  // (bids descending merged with asks ascending). Each series gets
  // NaN for the prices that don't belong to it — that produces the
  // expected "curve stops at the spread" rendering.
  const data = useMemo<AlignedData>(() => {
    const { bids, asks } = snapshot;
    if (bids.length === 0 && asks.length === 0) {
      return [[], [], []] as unknown as AlignedData;
    }

    // Build a single ascending price ladder: bids reversed (so they
    // ascend left → right at lower prices), then asks. uPlot REQUIRES
    // x values to be strictly ascending.
    const bidPricesAsc = [...bids].reverse().map((b) => b.price);
    const askPrices = asks.map((a) => a.price);
    const xs = [...bidPricesAsc, ...askPrices];

    // Build bid series — value at each x. Bid x's get the cum value
    // (we have to map back; bids was descending originally so the cum
    // ASCENDS as we move left from the spread). For asks: NaN.
    const bidCumByPrice = new Map<number, number>();
    bids.forEach((b) => bidCumByPrice.set(b.price, b.cum));
    const askCumByPrice = new Map<number, number>();
    asks.forEach((a) => askCumByPrice.set(a.price, a.cum));

    const bidSeries: Array<number | null> = xs.map((x) =>
      bidCumByPrice.has(x) ? bidCumByPrice.get(x)! : null,
    );
    const askSeries: Array<number | null> = xs.map((x) =>
      askCumByPrice.has(x) ? askCumByPrice.get(x)! : null,
    );

    return [xs, bidSeries, askSeries] as unknown as AlignedData;
  }, [snapshot]);

  // uPlot opts — memoised so the lifecycle hook doesn't rebuild the
  // chart on every render. Colours come from CSS-var reads above so
  // a theme switch propagates by calling `instance.setSeries({stroke})`
  // via the seriesEffect below.
  const opts = useMemo<Options>(
    () => ({
      width: 300,
      height,
      // Smaller padding than the uPlot default — the depth chart lives
      // in a tight 120-px row next to the candles.
      padding: [8, 4, 4, 4],
      legend: { show: false },
      cursor: {
        // Show crosshair + per-series value on hover.
        show: true,
        x: true,
        y: true,
        points: { show: false },
      },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          // Price axis — keep the labels light, BuFi mono.
          stroke: accents.ink3,
          grid: { show: false },
          ticks: { show: false },
          values: (_self, splits) =>
            splits.map((s) => fmtPriceForDepth(Number(s))),
        },
        {
          stroke: accents.ink3,
          grid: { stroke: accents.ink3, width: 0.5 },
          ticks: { show: false },
          values: (_self, splits) =>
            splits.map((s) => fmtSizeForDepth(Number(s))),
        },
      ],
      series: [
        { label: "Price" },
        {
          label: "Bids",
          stroke: accents.profit,
          fill: `${accents.profit}26`, // ~15% alpha
          width: 1.5,
          // Stepped path = the staircase look. align: 1 makes the size
          // value sit at the RIGHT edge of each step, so the spread
          // line lands precisely between the best-bid and best-ask
          // verticals.
          paths: uPlot.paths.stepped!({ align: 1 }),
          points: { show: false },
          value: (_self, raw) =>
            raw == null || Number.isNaN(raw) ? "—" : fmtSizeForDepth(raw),
        },
        {
          label: "Asks",
          stroke: accents.loss,
          fill: `${accents.loss}26`,
          width: 1.5,
          paths: uPlot.paths.stepped!({ align: -1 }),
          points: { show: false },
          value: (_self, raw) =>
            raw == null || Number.isNaN(raw) ? "—" : fmtSizeForDepth(raw),
        },
      ],
    }),
    // Re-creating the opts object when the theme changes would force a
    // full chart rebuild via the useUplot optsKey. We avoid that — the
    // seriesEffect below patches the live instance in place instead,
    // which is ~100× cheaper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [height],
  );

  const { containerRef, instanceRef } = useUplot({ opts, data, optsKey: `depth-${height}` });

  // Theme-switch hot patch — mutate series strokes in place + force a
  // redraw. uPlot's `setSeries(idx, opts)` only takes `{show, focus}`
  // by type contract; visual prop changes go through the series object
  // and a `redraw()` call. We accept the minor type-cast cost rather
  // than rebuild the chart on every theme flip.
  useEffect(() => {
    const plot = instanceRef.current;
    if (!plot) return;
    const seriesList = (plot as unknown as { series: Array<{ stroke?: unknown; fill?: unknown }> })
      .series;
    if (seriesList[1]) {
      seriesList[1].stroke = accents.profit;
      seriesList[1].fill = `${accents.profit}26`;
    }
    if (seriesList[2]) {
      seriesList[2].stroke = accents.loss;
      seriesList[2].fill = `${accents.loss}26`;
    }
    plot.redraw(false, true);
  }, [accents.profit, accents.loss, instanceRef]);

  const empty = snapshot.bids.length === 0 && snapshot.asks.length === 0;

  return (
    <div
      className="card depth-chart-card"
      style={{
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="depth-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-3)", letterSpacing: 0.4 }}>
          DEPTH
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
          {snapshot.bestBid != null && snapshot.bestAsk != null
            ? `${fmtPriceForDepth(snapshot.bestBid)} / ${fmtPriceForDepth(snapshot.bestAsk)}`
            : "—"}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          height,
        }}
      >
        {empty && (
          <div
            aria-live="polite"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 10.5,
              fontWeight: 700,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {pending.isLoading || live.status === "connecting"
              ? "Waiting for book stream…"
              : "No depth yet"}
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%" }}
          aria-label="Cumulative orderbook depth chart"
        />
      </div>
    </div>
  );
}
