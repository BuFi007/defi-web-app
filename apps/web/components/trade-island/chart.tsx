"use client";

/**
 * Sprint D — lightweight-charts engine swap.
 *
 * Drop-in replacement for the legacy custom-canvas `CandleChart`. Same required
 * props (`market`, `timeframe`); optional overlay props (`oracleLine`,
 * `liquidationPrice`, `entryPrice`, `markPrice`) light up additional series and
 * PriceLines when callers wire real `usePositions` data (Sprint A).
 *
 * Hard rules:
 *   - Never green/red. Every color option is mapped to a CSS var: purple for
 *     profit, yellow (pink in current theme) for loss, primary for entry.
 *   - Data comes from `@bufi/market-data` `getCandles({ source })` — defaults to
 *     `mock` so the surface keeps rendering before Sprint E lands.
 *   - ResizeObserver drives layout; no `window.resize` listener leak across
 *     re-renders.
 */

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import {
  getCandles,
  type Candle,
  type CandleSource,
} from "@bufi/market-data";
import { useLiveMarket } from "@/lib/perps/use-live-market";
import type { Market } from "./data";

/**
 * Read the active theme straight from `<html data-theme>` — the same
 * attribute the rest of the app's CSS uses for its `[data-theme="dark"]`
 * variable swaps. `useSpacemanTheme().resolvedTheme` was occasionally
 * returning "dark" even when the data-theme attribute (and therefore
 * the visible page) was "light", presumably because the spaceman
 * library and the ThemeAttributeSync MutationObserver hydrate from
 * separate sources. Reading the attribute directly removes that drift.
 */
function useDataTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => {
      const next =
        root.getAttribute("data-theme") === "dark" ? "dark" : "light";
      setTheme((prev) => (prev === next ? prev : next));
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export interface CandleChartProps {
  market: Market;
  timeframe: string;
  /** Defaults to `'mock'` until Sprint A wires ponder + Sprint E wires WS. */
  source?: CandleSource;
  /**
   * Optional realtime overlay. Defaults to `'mock'` so existing callers and
   * tests see identical behavior. When set to `'ws'` the chart subscribes to
   * the live-market WebSocket and updates the last candle's close on each
   * tick via `series.update(...)`. If the WS is down or `NEXT_PUBLIC_API_URL`
   * is unset, the chart silently falls back to the historical/mock series.
   */
  liveSource?: "ws" | "mock";
  /** Faint mid/oracle overlay; same length as candles array, aligned by index. */
  oracleLine?: number[];
  /** PriceLine overlays — render only when a value is provided. */
  liquidationPrice?: number;
  entryPrice?: number;
  markPrice?: number;
}

type ThemeTokens = {
  surface: string;
  surface2: string;
  border: string;
  ink: string;
  ink3: string;
  ink4: string;
  profit: string;
  profitInk: string;
  loss: string;
  lossInk: string;
  primary: string;
  primaryInk: string;
};

/** Stealth palette used when Private Trading mode is ON. Mirrors the
 *  same token shape as the live CSS-variable read, but with values
 *  hardcoded to a deep navy/black so the chart reads as private
 *  regardless of the user's overall light/dark preference. */
const PRIVATE_TOKENS: ThemeTokens = {
  surface: "#0c0a1f",
  surface2: "#15123a",
  border: "#241d4f",
  ink: "#f0ecff",
  ink3: "#8479c4",
  ink4: "#5a4f87",
  profit: "#5b4ccd",
  profitInk: "#a89dff",
  loss: "#a64682",
  lossInk: "#ff84d4",
  primary: "#8474ff",
  primaryInk: "#a89dff",
};

function readThemeTokens(privateMode = false): ThemeTokens {
  if (privateMode) return PRIVATE_TOKENS;
  if (typeof window === "undefined") {
    return {
      surface: "#ffffff",
      surface2: "#faf7ff",
      border: "#ebe4ff",
      ink: "#1f1740",
      ink3: "#7c70a8",
      ink4: "#b6abd6",
      profit: "#a89ce8",
      profitInk: "#4d3fa6",
      loss: "#feadec",
      lossInk: "#b8458e",
      primary: "#6b5bff",
      primaryInk: "#4233c4",
    };
  }
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--surface", "#ffffff"),
    surface2: v("--surface-2", "#faf7ff"),
    border: v("--border", "#ebe4ff"),
    ink: v("--ink", "#1f1740"),
    ink3: v("--ink-3", "#7c70a8"),
    ink4: v("--ink-4", "#b6abd6"),
    profit: v("--profit", "#a89ce8"),
    profitInk: v("--profit-ink", "#4d3fa6"),
    loss: v("--loss", "#feadec"),
    lossInk: v("--loss-ink", "#b8458e"),
    primary: v("--primary", "#6b5bff"),
    primaryInk: v("--primary-ink", "#4233c4"),
  };
}

// Volume bar opacity — keep low so candles dominate. Hex alpha trick: append.
function withAlpha(hex: string, alphaByte: string): string {
  if (!hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) return hex;
  const norm = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return `${norm}${alphaByte}`;
}

export function CandleChart({
  market,
  timeframe,
  source = "mock",
  liveSource = "mock",
  oracleLine,
  liquidationPrice,
  entryPrice,
  markPrice,
}: CandleChartProps) {
  // Chart palette follows `<html data-theme>` (the canonical CSS source
  // of truth). Dark theme === private trading visual (PRIVATE_TOKENS).
  // We read the attribute directly via MutationObserver so the chart
  // is byte-identical to whatever the page CSS is currently rendering,
  // with no library-internal state to drift from.
  const dataTheme = useDataTheme();
  const privateMode = dataTheme === "dark";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oracleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  // Tracks the last seed candle pushed into the series so live updates fold
  // the new mark into the *latest* bar instead of appending a fresh one.
  const lastCandleRef = useRef<Candle | null>(null);
  // Cache of the historical candle array so the private-mode theme swap
  // can re-color the volume bars in-place without a Pyth Benchmarks
  // re-fetch. Filled from the load effect; cleared on market/timeframe
  // change via the load effect's reset path.
  const candlesRef = useRef<Candle[]>([]);
  const [hover, setHover] = useState<Candle | null>(null);
  // Tri-state for the "no historical OHLCV yet" overlay. 'loading' on
  // first mount + every market/tf change; 'ready' once candles arrive
  // OR a live tick lands; 'empty' when the historical fetch returned
  // [] AND no live tick has shown up yet.
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "empty">(
    "loading",
  );

  // Subscribe to the live WS feed only when the caller opted in. The hook
  // gracefully returns `tick === null` + `status === 'error'` when the env
  // var is missing, so the chart silently keeps rendering historical data.
  const live = useLiveMarket(market.sym, { enabled: liveSource === "ws" });

  // Chart lifecycle — create once, dispose on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const t = readThemeTokens(privateMode);
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.ink3,
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: t.border, style: LineStyle.Dotted },
        horzLines: { color: t.border, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: t.border,
        textColor: t.ink4,
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: t.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: t.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.primary },
        horzLine: { color: t.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.primary },
      },
      autoSize: false,
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: t.profit,
      downColor: t.loss,
      borderUpColor: t.profitInk,
      borderDownColor: t.lossInk,
      wickUpColor: t.profitInk,
      wickDownColor: t.lossInk,
      priceFormat: {
        type: "price",
        precision: market.price < 10 ? 4 : market.price < 1000 ? 2 : 1,
        minMove: market.price < 10 ? 0.0001 : market.price < 1000 ? 0.01 : 0.1,
      },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      // Bars rendered in their own micro-scale so they sit under the candles.
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      borderVisible: false,
    });

    const oracleSeries = chart.addSeries(LineSeries, {
      color: withAlpha(t.primary, "66"),
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    oracleSeriesRef.current = oracleSeries;

    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el || !chartRef.current) return;
      chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      oracleSeriesRef.current = null;
      priceLinesRef.current = [];
    };
    // Intentionally no deps — chart is reused across data/theme updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap effect — re-applies layout / grid / scale colors AND
  // candle/volume series colors to the existing chart instance when
  // `privateMode` flips. No chart teardown; lightweight-charts handles
  // applyOptions reactively. Skipped on first paint because the create
  // effect above already builds the chart with the correct palette
  // (since `privateMode` is read synchronously there).
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const oracleSeries = oracleSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !oracleSeries) return;
    const t = readThemeTokens(privateMode);
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.ink3,
      },
      grid: {
        vertLines: { color: t.border, style: LineStyle.Dotted },
        horzLines: { color: t.border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: t.border, textColor: t.ink4 },
      timeScale: { borderColor: t.border },
      crosshair: {
        vertLine: {
          color: t.ink3,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: t.primary,
        },
        horzLine: {
          color: t.ink3,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: t.primary,
        },
      },
    });
    candleSeries.applyOptions({
      upColor: t.profit,
      downColor: t.loss,
      borderUpColor: t.profitInk,
      borderDownColor: t.lossInk,
      wickUpColor: t.profitInk,
      wickDownColor: t.lossInk,
    });
    oracleSeries.applyOptions({ color: withAlpha(t.primary, "66") });
    // Volume bar colors are per-data-point, so applyOptions isn't enough —
    // we have to re-emit the volume array with new colors. Cached candles
    // mean no network round-trip.
    const cached = candlesRef.current;
    if (cached.length > 0) {
      volumeSeries.setData(
        cached.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.v,
          color: c.c >= c.o ? withAlpha(t.profit, "55") : withAlpha(t.loss, "55"),
        })),
      );
    }
  }, [privateMode]);

  // Historical OHLCV load — fires on symbol / timeframe / source change.
  // Pyth Hermes pushes a live mark price several times per second, which
  // mutates `market.price`; if it lived in this dep list the load would
  // re-fire (and flip the overlay back to "loading") on every tick. The
  // live-tick fold-in effect below appends the new mark into the in-memory
  // candle series instead, so the historical fetch genuinely only needs
  // to re-run when the user picks a different market or timeframe.
  // `basePrice` below is a synthesizer fallback used by the "mock" source
  // when no real candles exist — we read it from a ref so updates to the
  // live mark don't invalidate this effect's deps.
  const basePriceRef = useRef(market.price);
  basePriceRef.current = market.price;
  useEffect(() => {
    let cancelled = false;
    setChartStatus("loading");
    const load = async () => {
      const candles = await getCandles({
        source,
        marketId: market.sym,
        tf: timeframe,
        basePrice: basePriceRef.current,
        limit: 200,
      });
      if (cancelled) return;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      const oracleSeries = oracleSeriesRef.current;
      const chart = chartRef.current;
      if (!candleSeries || !volumeSeries || !oracleSeries || !chart) return;

      const t = readThemeTokens(privateMode);
      const candleData: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      }));
      const volumeData: HistogramData<UTCTimestamp>[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.v,
        color: c.c >= c.o ? withAlpha(t.profit, "55") : withAlpha(t.loss, "55"),
      }));
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      lastCandleRef.current = candles.length ? candles[candles.length - 1] : null;
      candlesRef.current = candles;
      setChartStatus(candles.length > 0 ? "ready" : "empty");

      if (oracleLine && oracleLine.length === candles.length) {
        const oracleData: LineData<UTCTimestamp>[] = candles.map((c, i) => ({
          time: c.time as UTCTimestamp,
          value: oracleLine[i],
        }));
        oracleSeries.setData(oracleData);
      } else {
        oracleSeries.setData([]);
      }

      chart.timeScale().fitContent();
    };
    void load();
    return () => {
      cancelled = true;
    };
    // Intentionally omit `market.price` and `oracleLine` — both update on
    // every live tick (price) or on every parent re-render (oracleLine
    // array identity), and re-running the 200-candle Pyth Benchmarks
    // fetch on every tick is what was causing the chart overlay to flip
    // between "loading" and "ready" several times per second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.sym, timeframe, source]);

  // Flip out of 'empty' the moment a live tick arrives — the live-fold
  // effect below will append a candle to the series, so the overlay
  // should disappear immediately. Avoids the "empty state on a chart
  // that's actually streaming" flash.
  useEffect(() => {
    if (live.tick && chartStatus === "empty") setChartStatus("ready");
  }, [live.tick, chartStatus]);

  // Flip out of 'empty' the moment a live tick arrives — the live-fold
  // effect below will append a candle to the series, so the overlay
  // should disappear immediately. Avoids the "empty state on a chart
  // that's actually streaming" flash.
  useEffect(() => {
    if (live.tick && chartStatus === "empty") setChartStatus("ready");
  }, [live.tick, chartStatus]);

  // PriceLines — recreated whenever the prop bag changes. Cheap; only 1–3 lines.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const t = readThemeTokens(privateMode);
    for (const pl of priceLinesRef.current) candleSeries.removePriceLine(pl);
    priceLinesRef.current = [];

    if (typeof entryPrice === "number" && Number.isFinite(entryPrice)) {
      priceLinesRef.current.push(
        candleSeries.createPriceLine({
          price: entryPrice,
          color: t.primary,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "ENTRY",
        }),
      );
    }
    if (typeof liquidationPrice === "number" && Number.isFinite(liquidationPrice)) {
      priceLinesRef.current.push(
        candleSeries.createPriceLine({
          price: liquidationPrice,
          color: t.lossInk,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "LIQ",
        }),
      );
    }
    if (typeof markPrice === "number" && Number.isFinite(markPrice)) {
      priceLinesRef.current.push(
        candleSeries.createPriceLine({
          price: markPrice,
          color: t.primaryInk,
          lineStyle: LineStyle.Solid,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "MARK",
        }),
      );
    }
    // privateMode in deps so entry/liq/mark line colors swap with the
    // palette when stealth mode flips.
  }, [entryPrice, liquidationPrice, markPrice, privateMode]);

  // Live-tick fold-in. Only runs when `liveSource === 'ws'` AND the hook has
  // delivered a tick. We mutate the in-memory `lastCandleRef` so subsequent
  // ticks compose against the rolling high/low instead of resetting on every
  // re-render. `series.update(...)` with the existing time → in-place update;
  // with a new time → append. Never `setData` here — that thrashes the chart.
  useEffect(() => {
    if (liveSource !== "ws") return;
    const tick = live.tick;
    if (!tick) return;
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const seed = lastCandleRef.current;
    if (!seed) return;
    const mark = tick.mark;
    if (!Number.isFinite(mark) || mark <= 0) return;
    // Fold the new mark into the last seed candle. If the WS server has
    // rolled into a new bucket (`tick.lastCandle.time > seed.time`), append
    // a fresh candle; lightweight-charts requires monotonic times.
    let next: Candle;
    if (tick.lastCandle.time > seed.time) {
      next = {
        time: tick.lastCandle.time,
        o: mark,
        h: mark,
        l: mark,
        c: mark,
        v: 0,
      };
    } else {
      next = {
        time: seed.time,
        o: seed.o,
        h: Math.max(seed.h, mark),
        l: Math.min(seed.l, mark),
        c: mark,
        v: seed.v,
      };
    }
    candleSeries.update({
      time: next.time as UTCTimestamp,
      open: next.o,
      high: next.h,
      low: next.l,
      close: next.c,
    });
    lastCandleRef.current = next;
  }, [liveSource, live.tick]);

  // Crosshair → OHLC tooltip. We render into a small overlay anchored top-left
  // so we don't fight the existing `.chart-substats` row above the chart.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;
    const handler = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const candle = param.seriesData.get(candleSeries) as
        | CandlestickData<UTCTimestamp>
        | undefined;
      const vol = param.seriesData.get(volumeSeries) as
        | HistogramData<UTCTimestamp>
        | undefined;
      if (!candle) {
        setHover(null);
        return;
      }
      setHover({
        time: candle.time as number,
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: vol?.value ?? 0,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  // Silence unused — `SeriesMarker` import kept for future Sprint-A markers.
  void (null as unknown as SeriesMarker<UTCTimestamp>);

  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  return (
    <div ref={containerRef} className="chart-area">
      {hover && (
        <div className="chart-ohlc-tooltip mono" aria-hidden>
          <span className="chart-ohlc-label">O</span>
          <span>{hover.o.toFixed(dec)}</span>
          <span className="chart-ohlc-label">H</span>
          <span>{hover.h.toFixed(dec)}</span>
          <span className="chart-ohlc-label">L</span>
          <span>{hover.l.toFixed(dec)}</span>
          <span className="chart-ohlc-label">C</span>
          <span
            style={{ color: hover.c >= hover.o ? "var(--profit-ink)" : "var(--loss-ink)" }}
          >
            {hover.c.toFixed(dec)}
          </span>
          <span className="chart-ohlc-label">V</span>
          <span>{Math.round(hover.v)}</span>
        </div>
      )}
      {chartStatus !== "ready" && (
        <div className="chart-empty" role="status" aria-live="polite">
          <div className="chart-empty-inner">
            <div className="chart-empty-glyph" aria-hidden>
              {chartStatus === "loading" ? "◌" : "—"}
            </div>
            <div className="chart-empty-title mono">
              {chartStatus === "loading"
                ? "Loading market history…"
                : "No trading history yet"}
            </div>
            <div className="chart-empty-sub">
              {chartStatus === "loading"
                ? "Fetching candles from Pyth Benchmarks."
                : `No OHLCV available for ${market.sym} on the ${timeframe} timeframe yet. Live ticks will start a fresh series.`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
