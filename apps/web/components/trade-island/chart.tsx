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
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import {
  getCandles,
  timeframeToSeconds,
  type Candle,
  type CandleSource,
  type Tick,
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

const INITIAL_CANDLE_LIMIT = 240;
const INITIAL_VISIBLE_BARS = 96;
const HISTORY_PAGE_LIMIT = 500;
const BASE_BACKFILL_PAGES_PER_BATCH = 4;
const MAX_BACKFILL_PAGES_PER_BATCH = 12;
const MAX_BACKFILL_FETCHES_PER_PAGE = 12;
const MAX_BACKFILL_FETCHES_PER_TIMEFRAME = 2;
const MIN_EMPTY_BACKFILL_SKIPS = 4;
const EMPTY_BACKFILL_SCAN_SECONDS = 4 * 24 * 60 * 60;
const EMPTY_BACKFILL_CONTINUE_MS = 350;
const LEFT_EDGE_PREFETCH_BARS = 120;
const PREFETCH_VISIBLE_SPAN_MULTIPLIER = 1.75;
const MAX_PREFETCH_BARS = 2_000;
const RIGHT_OFFSET_BARS = 8;
const INITIAL_BAR_SPACING = 8;
const MIN_BAR_SPACING = 0.5;
const MAX_BAR_SPACING = 24;
const BACKFILL_FLOOR_SECONDS = 0;
const BACKFILL_TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
const CANDLE_FETCH_CACHE_MAX_ENTRIES = 240;

type CandleFetchArgs = {
  source: CandleSource;
  marketId: string;
  tf: string;
  limit?: number;
  from?: number;
  to?: number;
  basePrice?: number;
};

const candleFetchCache = new Map<string, Candle[] | Promise<Candle[]>>();

function cloneCandles(candles: Candle[]): Candle[] {
  return candles.map((c) => ({ ...c }));
}

function candleFetchCacheKey(args: CandleFetchArgs): string {
  const from = Number.isFinite(args.from) ? Math.floor(args.from!) : "";
  const to = Number.isFinite(args.to) ? Math.floor(args.to!) : "";
  const basePrice = args.source === "mock" && Number.isFinite(args.basePrice)
    ? args.basePrice
    : "";
  return [
    args.source,
    args.marketId,
    args.tf,
    args.limit ?? "",
    from,
    to,
    basePrice,
  ].join(":");
}

function trimCandleFetchCache() {
  while (candleFetchCache.size > CANDLE_FETCH_CACHE_MAX_ENTRIES) {
    const oldest = candleFetchCache.keys().next().value;
    if (!oldest) break;
    candleFetchCache.delete(oldest);
  }
}

async function fetchCachedCandles(args: CandleFetchArgs): Promise<Candle[]> {
  const key = candleFetchCacheKey(args);
  const cached = candleFetchCache.get(key);
  if (cached) return cloneCandles(await cached);
  const request = getCandles(args).then(normalizeCandles);
  candleFetchCache.set(key, request);
  try {
    const candles = await request;
    candleFetchCache.set(key, candles);
    trimCandleFetchCache();
    return cloneCandles(candles);
  } catch (err) {
    if (candleFetchCache.get(key) === request) candleFetchCache.delete(key);
    throw err;
  }
}

function candleToSeriesData(c: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: c.time as UTCTimestamp,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
  };
}

function volumeToSeriesData(c: Candle, t: ThemeTokens): HistogramData<UTCTimestamp> {
  return {
    time: c.time as UTCTimestamp,
    value: c.v,
    color: c.c >= c.o ? withAlpha(t.profit, "55") : withAlpha(t.loss, "55"),
  };
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.time)) continue;
    byTime.set(candle.time, candle);
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

function mergeCandles(older: Candle[], current: Candle[]): {
  candles: Candle[];
  insertedBefore: number;
} {
  const oldestCurrent = current[0]?.time ?? Infinity;
  const prepend: Candle[] = [];
  let lastPrependedTime = -Infinity;
  for (const candle of older) {
    if (candle.time >= oldestCurrent || candle.time === lastPrependedTime) continue;
    prepend.push(candle);
    lastPrependedTime = candle.time;
  }
  return {
    candles: prepend.length > 0 ? [...prepend, ...current] : current,
    insertedBefore: prepend.length,
  };
}

function emptyBackfillSkips(tf: string): number {
  const pageSpan = timeframeToSeconds(tf) * HISTORY_PAGE_LIMIT;
  return Math.max(
    MIN_EMPTY_BACKFILL_SKIPS,
    Math.ceil(EMPTY_BACKFILL_SCAN_SECONDS / pageSpan),
  );
}

function backfillTimeframes(tf: string): string[] {
  const i = BACKFILL_TIMEFRAMES.findIndex((x) => x === tf);
  return Array.from(BACKFILL_TIMEFRAMES.slice(i >= 0 ? i : 2));
}

function visibleBarSpan(range: { from: number; to: number } | LogicalRange): number {
  return Math.max(0, Number(range.to) - Number(range.from));
}

function adaptivePrefetchBars(range: { from: number; to: number } | LogicalRange): number {
  const span = visibleBarSpan(range);
  return Math.min(
    MAX_PREFETCH_BARS,
    Math.max(LEFT_EDGE_PREFETCH_BARS, Math.ceil(span * PREFETCH_VISIBLE_SPAN_MULTIPLIER)),
  );
}

function backfillPageBudget(range: { from: number; to: number } | LogicalRange): number {
  const span = visibleBarSpan(range);
  return Math.min(
    MAX_BACKFILL_PAGES_PER_BATCH,
    Math.max(BASE_BACKFILL_PAGES_PER_BATCH, Math.ceil(span / HISTORY_PAGE_LIMIT) + 2),
  );
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
  const themeTokensRef = useRef<ThemeTokens | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oracleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const loadingOlderRef = useRef(false);
  const historyExhaustedRef = useRef(false);
  const backfillSearchToRef = useRef<number | null>(null);
  const historyKeyRef = useRef("");
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverOpenRef = useRef<HTMLSpanElement | null>(null);
  const hoverHighRef = useRef<HTMLSpanElement | null>(null);
  const hoverLowRef = useRef<HTMLSpanElement | null>(null);
  const hoverCloseRef = useRef<HTMLSpanElement | null>(null);
  const hoverVolumeRef = useRef<HTMLSpanElement | null>(null);
  const candleDataRef = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const volumeDataRef = useRef<HistogramData<UTCTimestamp>[]>([]);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<Candle | null>(null);
  const liveTickHandlerRef = useRef<(tick: Tick) => void>(() => undefined);
  // Tracks the last seed candle pushed into the series so live updates fold
  // the new mark into the *latest* bar instead of appending a fresh one.
  const lastCandleRef = useRef<Candle | null>(null);
  // Cache of the historical candle array so the private-mode theme swap
  // can re-color the volume bars in-place without a Pyth Benchmarks
  // re-fetch. Filled from the load effect; cleared on market/timeframe
  // change via the load effect's reset path.
  const candlesRef = useRef<Candle[]>([]);
  // Tri-state for the "no historical OHLCV yet" overlay. 'loading' on
  // first mount + every market/tf change; 'ready' once candles arrive
  // OR a live tick lands; 'empty' when the historical fetch returned
  // [] AND no live tick has shown up yet.
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "empty">(
    "loading",
  );

  liveTickHandlerRef.current = (tick: Tick) => {
    if (liveSource !== "ws") return;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;
    const seed = lastCandleRef.current;
    if (!seed) return;
    const mark = tick.mark;
    if (!Number.isFinite(mark) || mark <= 0) return;
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
    const nextCandleData = candleToSeriesData(next);
    const nextVolumeData = volumeToSeriesData(
      next,
      themeTokensRef.current ?? readThemeTokens(privateMode),
    );
    volumeSeries.update(nextVolumeData);
    lastCandleRef.current = next;
    const cached = candlesRef.current;
    if (cached.length === 0) {
      candlesRef.current = [next];
      candleDataRef.current = [nextCandleData];
      volumeDataRef.current = [nextVolumeData];
    } else if (cached[cached.length - 1]!.time === next.time) {
      cached[cached.length - 1] = next;
      candleDataRef.current[candleDataRef.current.length - 1] = nextCandleData;
      volumeDataRef.current[volumeDataRef.current.length - 1] = nextVolumeData;
    } else if (cached[cached.length - 1]!.time < next.time) {
      cached.push(next);
      candleDataRef.current.push(nextCandleData);
      volumeDataRef.current.push(nextVolumeData);
    }
    setChartStatus((status) => (status === "empty" ? "ready" : status));
  };

  // Subscribe to the live WS feed only when the caller opted in. Ticks are
  // consumed through an imperative callback so the canvas can update without
  // forcing a React render on every mark-price update.
  useLiveMarket(market.sym, {
    enabled: liveSource === "ws",
    publishTicks: false,
    onTick: (tick) => liveTickHandlerRef.current(tick),
  });
  const priceDecimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const priceDecimalsRef = useRef(priceDecimals);
  priceDecimalsRef.current = priceDecimals;

  // Chart lifecycle — create once, dispose on unmount.
  useEffect(() => {
    if (!chartHostRef.current) return;
    const t = readThemeTokens(privateMode);
    themeTokensRef.current = t;
    const chart = createChart(chartHostRef.current, {
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
        rightOffset: RIGHT_OFFSET_BARS,
        barSpacing: INITIAL_BAR_SPACING,
        minBarSpacing: MIN_BAR_SPACING,
        maxBarSpacing: MAX_BAR_SPACING,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: t.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.primary },
        horzLine: { color: t.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.primary },
      },
      autoSize: false,
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: { mouse: true, touch: true },
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
      const el = chartHostRef.current;
      if (!el || !chartRef.current) return;
      chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(chartHostRef.current);

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
    themeTokensRef.current = t;
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
      const volumeData = cached.map((c) => volumeToSeriesData(c, t));
      volumeDataRef.current = volumeData;
      volumeSeries.setData(volumeData);
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
    const historyKey = `${source}:${market.sym}:${timeframe}`;
    historyKeyRef.current = historyKey;
    loadingOlderRef.current = false;
    historyExhaustedRef.current = false;
    backfillSearchToRef.current = null;
    candlesRef.current = [];
    candleDataRef.current = [];
    volumeDataRef.current = [];
    lastCandleRef.current = null;
    setChartStatus("loading");
    const load = async () => {
      const candles = await fetchCachedCandles({
        source,
        marketId: market.sym,
        tf: timeframe,
        basePrice: basePriceRef.current,
        limit: INITIAL_CANDLE_LIMIT,
      });
      if (cancelled) return;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      const oracleSeries = oracleSeriesRef.current;
      const chart = chartRef.current;
      if (historyKeyRef.current !== historyKey) return;
      if (!candleSeries || !volumeSeries || !oracleSeries || !chart) return;

      const t = themeTokensRef.current ?? readThemeTokens(privateMode);
      const candleData = candles.map(candleToSeriesData);
      const volumeData = candles.map((c) => volumeToSeriesData(c, t));
      candleDataRef.current = candleData;
      volumeDataRef.current = volumeData;
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      lastCandleRef.current = candles.length ? candles[candles.length - 1] : null;
      candlesRef.current = candles;
      setChartStatus(candles.length > 0 ? "ready" : "empty");
      historyExhaustedRef.current = candles.length === 0;

      if (oracleLine && oracleLine.length === candles.length) {
        const oracleData: LineData<UTCTimestamp>[] = candles.map((c, i) => ({
          time: c.time as UTCTimestamp,
          value: oracleLine[i],
        }));
        oracleSeries.setData(oracleData);
      } else {
        oracleSeries.setData([]);
      }

      if (candles.length > 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, candles.length - INITIAL_VISIBLE_BARS),
          to: candles.length - 1 + RIGHT_OFFSET_BARS,
        });
      }
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

  // Lazy backfill for pan/zoom. Initial render stays cheap; once the user
  // moves close to the loaded left edge, fetch older Benchmarks pages and
  // prepend them while preserving the current viewport's logical coordinates.
  useEffect(() => {
    if (source !== "ponder") return;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;
    const historyKey = `${source}:${market.sym}:${timeframe}`;

    const loadOlder = async (visibleRange: LogicalRange | null) => {
      if (loadingOlderRef.current || historyExhaustedRef.current) return;
      loadingOlderRef.current = true;
      let range: { from: number; to: number } | null = visibleRange
        ? { from: Number(visibleRange.from), to: Number(visibleRange.to) }
        : null;
      let shouldContinue = false;
      let continueDelayMs = 0;
      try {
        let pages = 0;
        let nextCandles = candlesRef.current;
        let insertedInBatch = 0;
        const backfillTfs = backfillTimeframes(timeframe);
        while (
          range &&
          Number.isFinite(range.from) &&
          range.from <= adaptivePrefetchBars(range) &&
          !historyExhaustedRef.current
        ) {
          const oldest = nextCandles[0];
          if (!oldest) break;
          const cursorTo = Math.min(
            backfillSearchToRef.current ?? oldest.time - 1,
            oldest.time - 1,
          );
          if (cursorTo <= BACKFILL_FLOOR_SECONDS) {
            historyExhaustedRef.current = true;
            break;
          }
          let olderOnly: Candle[] = [];
          let remainingFetches = MAX_BACKFILL_FETCHES_PER_PAGE;
          let farthestScannedTo = cursorTo;
          for (const backfillTf of backfillTfs) {
            if (remainingFetches <= 0 || olderOnly.length > 0) break;
            let pageTo = cursorTo;
            const pageSpan = timeframeToSeconds(backfillTf) * HISTORY_PAGE_LIMIT;
            const attempts = Math.min(
              remainingFetches,
              MAX_BACKFILL_FETCHES_PER_TIMEFRAME,
              emptyBackfillSkips(backfillTf) + 1,
            );
            for (let attempt = 0; attempt < attempts; attempt += 1) {
              remainingFetches -= 1;
              const older = await fetchCachedCandles({
                source,
                marketId: market.sym,
                tf: backfillTf,
                basePrice: basePriceRef.current,
                limit: HISTORY_PAGE_LIMIT,
                to: pageTo,
              });
              if (historyKeyRef.current !== historyKey) return;
              olderOnly = older.filter((c) => c.time < oldest.time);
              if (olderOnly.length > 0) break;
              pageTo -= pageSpan;
              farthestScannedTo = Math.min(farthestScannedTo, pageTo);
            }
          }
          if (olderOnly.length === 0) {
            backfillSearchToRef.current = Math.max(
              BACKFILL_FLOOR_SECONDS,
              farthestScannedTo,
            );
            historyExhaustedRef.current =
              backfillSearchToRef.current <= BACKFILL_FLOOR_SECONDS;
            shouldContinue =
              !historyExhaustedRef.current && range.from <= adaptivePrefetchBars(range);
            continueDelayMs = EMPTY_BACKFILL_CONTINUE_MS;
            break;
          }

          const { candles, insertedBefore } = mergeCandles(olderOnly, nextCandles);
          if (insertedBefore === 0) {
            const oldestCandidate = olderOnly[0]?.time ?? cursorTo;
            backfillSearchToRef.current = Math.max(
              BACKFILL_FLOOR_SECONDS,
              oldestCandidate - 1,
            );
            historyExhaustedRef.current =
              backfillSearchToRef.current <= BACKFILL_FLOOR_SECONDS;
            shouldContinue =
              !historyExhaustedRef.current && range.from <= adaptivePrefetchBars(range);
            continueDelayMs = EMPTY_BACKFILL_CONTINUE_MS;
            break;
          }
          backfillSearchToRef.current = null;
          nextCandles = candles;
          insertedInBatch += insertedBefore;

          range = {
            from: range.from + insertedBefore,
            to: range.to + insertedBefore,
          };
          pages += 1;
          if (pages >= backfillPageBudget(range)) {
            shouldContinue = range.from <= adaptivePrefetchBars(range);
            break;
          }
        }
        if (insertedInBatch > 0) {
          const t = themeTokensRef.current ?? readThemeTokens(privateMode);
          const prepended = nextCandles.slice(0, insertedInBatch);
          const candleData = [
            ...prepended.map(candleToSeriesData),
            ...candleDataRef.current,
          ];
          const volumeData = [
            ...prepended.map((c) => volumeToSeriesData(c, t)),
            ...volumeDataRef.current,
          ];
          candleDataRef.current = candleData;
          volumeDataRef.current = volumeData;
          candleSeries.setData(candleData);
          volumeSeries.setData(volumeData);
          candlesRef.current = nextCandles;
          lastCandleRef.current = nextCandles[nextCandles.length - 1] ?? null;
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        }
      } finally {
        loadingOlderRef.current = false;
      }
      if (shouldContinue) {
        window.setTimeout(() => {
          if (historyKeyRef.current !== historyKey) return;
          void loadOlder(chart.timeScale().getVisibleLogicalRange());
        }, continueDelayMs);
      }
    };

    const handler = (range: LogicalRange | null) => {
      if (!range || !Number.isFinite(range.from)) return;
      if (range.from <= adaptivePrefetchBars(range)) void loadOlder(range);
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    handler(timeScale.getVisibleLogicalRange());
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handler);
  }, [market.sym, timeframe, source, privateMode]);

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

  // Crosshair → OHLC tooltip. We render into a small overlay anchored top-left
  // so we don't fight the existing `.chart-substats` row above the chart. This
  // stays outside React state because crosshair events fire at pointer cadence.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;
    const scheduleHover = (next: Candle | null) => {
      hoverPendingRef.current = next;
      if (hoverFrameRef.current != null) return;
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const hover = hoverPendingRef.current;
        const tooltip = hoverTooltipRef.current;
        if (!tooltip) return;
        if (!hover) {
          tooltip.style.display = "none";
          return;
        }
        const dec = priceDecimalsRef.current;
        if (hoverOpenRef.current) hoverOpenRef.current.textContent = hover.o.toFixed(dec);
        if (hoverHighRef.current) hoverHighRef.current.textContent = hover.h.toFixed(dec);
        if (hoverLowRef.current) hoverLowRef.current.textContent = hover.l.toFixed(dec);
        if (hoverCloseRef.current) {
          hoverCloseRef.current.textContent = hover.c.toFixed(dec);
          hoverCloseRef.current.style.color =
            hover.c >= hover.o ? "var(--profit-ink)" : "var(--loss-ink)";
        }
        if (hoverVolumeRef.current) {
          hoverVolumeRef.current.textContent = String(Math.round(hover.v));
        }
        tooltip.style.display = "grid";
      });
    };
    const handler = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        scheduleHover(null);
        return;
      }
      const candle = param.seriesData.get(candleSeries) as
        | CandlestickData<UTCTimestamp>
        | undefined;
      const vol = param.seriesData.get(volumeSeries) as
        | HistogramData<UTCTimestamp>
        | undefined;
      if (!candle) {
        scheduleHover(null);
        return;
      }
      scheduleHover({
        time: candle.time as number,
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: vol?.value ?? 0,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => {
      chart.unsubscribeCrosshairMove(handler);
      if (hoverFrameRef.current != null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
    };
  }, []);

  // Silence unused — `SeriesMarker` import kept for future Sprint-A markers.
  void (null as unknown as SeriesMarker<UTCTimestamp>);

  return (
    <div className="chart-area">
      <div ref={chartHostRef} className="chart-canvas-host" />
      <div
        ref={hoverTooltipRef}
        className="chart-ohlc-tooltip mono"
        aria-hidden
        style={{ display: "none" }}
      >
        <span className="chart-ohlc-label">O</span>
        <span ref={hoverOpenRef} />
        <span className="chart-ohlc-label">H</span>
        <span ref={hoverHighRef} />
        <span className="chart-ohlc-label">L</span>
        <span ref={hoverLowRef} />
        <span className="chart-ohlc-label">C</span>
        <span ref={hoverCloseRef} />
        <span className="chart-ohlc-label">V</span>
        <span ref={hoverVolumeRef} />
      </div>
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
                ? "Fetching market history."
                : `No OHLCV available for ${market.sym} on the ${timeframe} timeframe yet. Live ticks will start a fresh series.`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
