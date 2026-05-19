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
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  getCandles,
  type Candle,
  type CandleSource,
} from "@bufi/market-data";
import { useLiveMarket } from "@/lib/perps/use-live-market";
import type { Market } from "./data";
import {
  selectClearTick,
  selectIndicators,
  selectTool,
  useChartToolbarStore,
  type DrawingTool,
} from "./chart-toolbar";

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

function readThemeTokens(): ThemeTokens {
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

// =====================================================================
// Drawing primitives — lightweight-charts v5 ISeriesPrimitive
// =====================================================================
//
// We store drawings as plain data (time + price anchors) and recompute pixel
// positions on every draw via the captured series + chart APIs. That lets
// the chart redraw correctly when the user pans/zooms or resizes the panel.
//
// Quirks of the v5 primitives API we ran into:
//   - `paneViews()` is supposed to return the SAME array reference when
//     nothing has changed (perf cache). Our drawings array is mutated via
//     copy-on-commit so each commit produces a fresh array; that's fine.
//   - The renderer is invoked inside `useBitmapCoordinateSpace`, which
//     hands you `bitmapSize` + `horizontalPixelRatio` / `verticalPixelRatio`
//     — you must multiply media-space pixel coords by those ratios when
//     drawing in bitmap space, OR use `useMediaCoordinateSpace` for a
//     CSS-pixel canvas. We use bitmap space and multiply, which keeps
//     lines crisp on high-DPI screens.
//   - `series.priceToCoordinate()` returns a NUMBER in media (CSS) pixels.
//     `chart.timeScale().timeToCoordinate(time)` does the same for the X
//     axis. Both can return `null` when the point is outside the visible
//     range — we cull those drawings rather than rendering at NaN.

export type DrawingShape =
  | {
      kind: "trendline";
      a: { time: UTCTimestamp; price: number };
      b: { time: UTCTimestamp; price: number };
    }
  | { kind: "hline"; price: number }
  | { kind: "vline"; time: UTCTimestamp }
  | {
      kind: "rect";
      a: { time: UTCTimestamp; price: number };
      b: { time: UTCTimestamp; price: number };
    }
  | {
      kind: "fib";
      a: { time: UTCTimestamp; price: number };
      b: { time: UTCTimestamp; price: number };
    }
  | { kind: "text"; time: UTCTimestamp; price: number; text: string };

interface DrawingThemeColors {
  primary: string;
  primaryInk: string;
  profit: string;
  profitInk: string;
  loss: string;
  lossInk: string;
  ink: string;
  ink3: string;
  border: string;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const DRAWINGS_LS_PREFIX = "bufi.chart.drawings.v1";
const drawingsKey = (sym: string, tf: string) =>
  `${DRAWINGS_LS_PREFIX}:${sym}:${tf}`;

function loadDrawings(sym: string, tf: string): DrawingShape[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(drawingsKey(sym, tf));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DrawingShape[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrawings(sym: string, tf: string, list: DrawingShape[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(drawingsKey(sym, tf), JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

interface DrawingRendererInput {
  drawings: DrawingShape[];
  preview: DrawingShape | null;
  series: ISeriesApi<"Candlestick">;
  chart: IChartApi;
  colors: DrawingThemeColors;
}

class DrawingPaneRenderer implements IPrimitivePaneRenderer {
  private readonly input: DrawingRendererInput;

  constructor(input: DrawingRendererInput) {
    this.input = input;
  }

  draw(target: import("fancy-canvas").CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
      const { drawings, preview, series, chart, colors } = this.input;
      const ts = chart.timeScale();
      const xOf = (t: UTCTimestamp): number | null => {
        const x = ts.timeToCoordinate(t as Time);
        return typeof x === "number" ? x * hr : null;
      };
      const yOf = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return typeof y === "number" ? y * vr : null;
      };

      const all: Array<{ d: DrawingShape; ghost: boolean }> = drawings.map(
        (d) => ({ d, ghost: false }),
      );
      if (preview) all.push({ d: preview, ghost: true });

      ctx.save();
      for (const { d, ghost } of all) {
        const stroke = ghost ? colors.ink3 : colors.primaryInk;
        const fill = ghost ? withAlphaCss(colors.primary, 0.12) : withAlphaCss(colors.primary, 0.18);
        const lineW = 1.4 * hr;
        ctx.lineWidth = lineW;
        ctx.strokeStyle = stroke;
        ctx.setLineDash(ghost ? [4 * hr, 3 * hr] : []);

        switch (d.kind) {
          case "trendline": {
            const x1 = xOf(d.a.time);
            const y1 = yOf(d.a.price);
            const x2 = xOf(d.b.time);
            const y2 = yOf(d.b.price);
            if (x1 == null || y1 == null || x2 == null || y2 == null) break;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // Anchors
            ctx.setLineDash([]);
            ctx.fillStyle = colors.primaryInk;
            ctx.beginPath();
            ctx.arc(x1, y1, 3 * hr, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x2, y2, 3 * hr, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case "hline": {
            const y = yOf(d.price);
            if (y == null) break;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(bitmapSize.width, y);
            ctx.stroke();
            // Price tag on the right edge
            ctx.setLineDash([]);
            ctx.fillStyle = withAlphaCss(colors.primary, 0.9);
            const label = formatNum(d.price);
            ctx.font = `${10 * hr}px ui-monospace, monospace`;
            const labelW = ctx.measureText(label).width + 8 * hr;
            const labelH = 14 * hr;
            ctx.fillRect(bitmapSize.width - labelW - 4 * hr, y - labelH / 2, labelW, labelH);
            ctx.fillStyle = colors.primaryInk;
            ctx.textBaseline = "middle";
            ctx.fillText(label, bitmapSize.width - labelW, y);
            break;
          }
          case "vline": {
            const x = xOf(d.time);
            if (x == null) break;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, bitmapSize.height);
            ctx.stroke();
            break;
          }
          case "rect": {
            const x1 = xOf(d.a.time);
            const y1 = yOf(d.a.price);
            const x2 = xOf(d.b.time);
            const y2 = yOf(d.b.price);
            if (x1 == null || y1 == null || x2 == null || y2 == null) break;
            const x = Math.min(x1, x2);
            const y = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
            break;
          }
          case "fib": {
            const x1 = xOf(d.a.time);
            const y1 = yOf(d.a.price);
            const x2 = xOf(d.b.time);
            const y2 = yOf(d.b.price);
            if (x1 == null || y1 == null || x2 == null || y2 == null) break;
            const xL = Math.min(x1, x2);
            const xR = Math.max(x1, x2);
            const pHi = Math.max(d.a.price, d.b.price);
            const pLo = Math.min(d.a.price, d.b.price);
            ctx.setLineDash([]);
            ctx.font = `${9 * hr}px ui-monospace, monospace`;
            for (const level of FIB_LEVELS) {
              const price = pHi - (pHi - pLo) * level;
              const y = yOf(price);
              if (y == null) continue;
              ctx.strokeStyle = level === 0 || level === 1 ? colors.primaryInk : colors.ink3;
              ctx.lineWidth = (level === 0 || level === 1 ? 1.4 : 1) * hr;
              ctx.beginPath();
              ctx.moveTo(xL, y);
              ctx.lineTo(xR, y);
              ctx.stroke();
              ctx.fillStyle = colors.ink3;
              ctx.fillText(
                `${level.toFixed(3)}  ${formatNum(price)}`,
                xL + 4 * hr,
                y - 3 * hr,
              );
            }
            break;
          }
          case "text": {
            const x = xOf(d.time);
            const y = yOf(d.price);
            if (x == null || y == null) break;
            ctx.setLineDash([]);
            ctx.font = `${11 * hr}px ui-sans-serif, system-ui, sans-serif`;
            const padX = 5 * hr;
            const padY = 3 * hr;
            const metrics = ctx.measureText(d.text);
            const w = metrics.width + padX * 2;
            const h = 14 * hr + padY * 2;
            ctx.fillStyle = withAlphaCss(colors.primary, 0.18);
            ctx.fillRect(x, y - h / 2, w, h);
            ctx.strokeStyle = withAlphaCss(colors.primaryInk, 0.8);
            ctx.strokeRect(x, y - h / 2, w, h);
            ctx.fillStyle = colors.ink;
            ctx.textBaseline = "middle";
            ctx.fillText(d.text, x + padX, y);
            break;
          }
        }
      }
      ctx.restore();
    });
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  private renderer_: DrawingPaneRenderer;
  constructor(input: DrawingRendererInput) {
    this.renderer_ = new DrawingPaneRenderer(input);
  }
  update(input: DrawingRendererInput) {
    this.renderer_ = new DrawingPaneRenderer(input);
  }
  renderer(): IPrimitivePaneRenderer | null {
    return this.renderer_;
  }
}

class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private view: DrawingPaneView;
  private input: DrawingRendererInput;
  private requestUpdate?: () => void;

  constructor(input: DrawingRendererInput) {
    this.input = input;
    this.view = new DrawingPaneView(input);
  }

  attached(param: { requestUpdate: () => void }) {
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.requestUpdate = undefined;
  }

  setState(next: Partial<DrawingRendererInput>) {
    this.input = { ...this.input, ...next };
    this.view.update(this.input);
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.view.update(this.input);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
}

function withAlphaCss(color: string, alpha: number): string {
  // Generic — handles #rrggbb, #rgb, and CSS color vars (returns as-is for vars).
  if (color.startsWith("var(")) return color;
  if (color.startsWith("#")) {
    if (color.length === 7) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (color.length === 4) {
      const r = parseInt(color[1] + color[1], 16);
      const g = parseInt(color[2] + color[2], 16);
      const b = parseInt(color[3] + color[3], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return color;
}

function formatNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

// =====================================================================
// Indicator math
// =====================================================================
function computeMA(closes: { time: UTCTimestamp; close: number }[], period: number): LineData<UTCTimestamp>[] {
  if (period < 2 || closes.length === 0) return [];
  const out: LineData<UTCTimestamp>[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i].close;
    if (i >= period) sum -= closes[i - period].close;
    if (i >= period - 1) {
      out.push({ time: closes[i].time, value: sum / period });
    }
  }
  return out;
}

function computeEMA(closes: { time: UTCTimestamp; close: number }[], period: number): LineData<UTCTimestamp>[] {
  if (period < 2 || closes.length === 0) return [];
  const k = 2 / (period + 1);
  const out: LineData<UTCTimestamp>[] = [];
  // Seed with a simple average of the first `period` closes for stability.
  if (closes.length < period) return [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i].close;
  let ema = sum / period;
  out.push({ time: closes[period - 1].time, value: ema });
  for (let i = period; i < closes.length; i++) {
    ema = closes[i].close * k + ema * (1 - k);
    out.push({ time: closes[i].time, value: ema });
  }
  return out;
}

function computeRSI(closes: { time: UTCTimestamp; close: number }[], period: number): LineData<UTCTimestamp>[] {
  if (period < 2 || closes.length <= period) return [];
  const out: LineData<UTCTimestamp>[] = [];
  // Wilder's smoothing.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i].close - closes[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: closes[period].time, value: rsi0 });
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i].close - closes[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: closes[i].time, value });
  }
  return out;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oracleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  // Tracks the last seed candle pushed into the series so live updates fold
  // the new mark into the *latest* bar instead of appending a fresh one.
  const lastCandleRef = useRef<Candle | null>(null);
  // Cached close series — fed to indicator math. Refreshed on every
  // historical load + live-tick fold so the indicators move in step.
  const closesRef = useRef<{ time: UTCTimestamp; close: number }[]>([]);
  // Indicator overlay series. MA/EMA share pane 0 with the candles; RSI
  // gets its own pane (index 1). All three are created lazily on first
  // enable and torn down on disable so the chart stays light when the
  // trader hasn't asked for them.
  const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Drawing-tool state. The primitive is a single instance attached to the
  // candle series — we mutate its input via setState() rather than
  // detach+reattach, which would flicker.
  const drawingsRef = useRef<DrawingShape[]>([]);
  const drawingPreviewRef = useRef<DrawingShape | null>(null);
  const drawingPendingPointRef = useRef<{ time: UTCTimestamp; price: number } | null>(null);
  const drawingPrimitiveRef = useRef<DrawingPrimitive | null>(null);
  // Latest store snapshots — refs so click handlers don't re-bind on every
  // tool change.
  const toolRef = useRef<DrawingTool>("cursor");
  // Mark + tf coordinate keys for localStorage.
  const persistKeyRef = useRef<{ sym: string; tf: string }>({ sym: market.sym, tf: timeframe });
  persistKeyRef.current = { sym: market.sym, tf: timeframe };

  const tool = useChartToolbarStore(selectTool);
  const indicators = useChartToolbarStore(selectIndicators);
  const clearTick = useChartToolbarStore(selectClearTick);
  toolRef.current = tool;

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
    const t = readThemeTokens();
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

    // Attach the drawing primitive once. The primitive holds its own
    // mutable input bag — we'll push new drawings into it via setState()
    // on commit, which keeps the array of paneViews stable.
    const drawingColors: DrawingThemeColors = {
      primary: t.primary,
      primaryInk: t.primaryInk,
      profit: t.profit,
      profitInk: t.profitInk,
      loss: t.loss,
      lossInk: t.lossInk,
      ink: t.ink,
      ink3: t.ink3,
      border: t.border,
    };
    const primitive = new DrawingPrimitive({
      drawings: drawingsRef.current,
      preview: null,
      series: candleSeries,
      chart,
      colors: drawingColors,
    });
    candleSeries.attachPrimitive(primitive);
    drawingPrimitiveRef.current = primitive;

    // --- Drawing click handler ------------------------------------------
    // We need both (time, price) for every click. v5 gives us `time` in
    // param.time (the bar's UTC timestamp under the cursor) and
    // `param.point.y` in media pixels — we convert that to a price via
    // series.coordinateToPrice. Snapping to the bar's time (vs. an
    // interpolated time) is intentional: it matches the magnet crosshair
    // and means drawings re-anchor cleanly on tf change.
    const onClick = (param: MouseEventParams) => {
      const t = toolRef.current;
      if (t === "cursor") return;
      if (!param.point || param.time == null) return;
      const series = candleSeriesRef.current;
      const ch = chartRef.current;
      if (!series || !ch) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const time = param.time as UTCTimestamp;
      const num = Number(price);

      const commit = (shape: DrawingShape) => {
        const next = [...drawingsRef.current, shape];
        drawingsRef.current = next;
        drawingPreviewRef.current = null;
        drawingPendingPointRef.current = null;
        const { sym, tf } = persistKeyRef.current;
        saveDrawings(sym, tf, next);
        pushDrawingsToPrimitive();
      };

      if (t === "hline") {
        commit({ kind: "hline", price: num });
        return;
      }
      if (t === "vline") {
        commit({ kind: "vline", time });
        return;
      }
      if (t === "text") {
        const label = typeof window !== "undefined"
          ? (window.prompt("Text annotation:", "") ?? "").trim()
          : "";
        if (!label) return;
        commit({ kind: "text", time, price: num, text: label });
        return;
      }

      // Two-point tools: trendline, rect, fib. First click stashes the
      // anchor; second click commits.
      const pending = drawingPendingPointRef.current;
      if (!pending) {
        drawingPendingPointRef.current = { time, price: num };
        return;
      }
      drawingPendingPointRef.current = null;
      drawingPreviewRef.current = null;
      switch (t) {
        case "trendline":
          commit({ kind: "trendline", a: pending, b: { time, price: num } });
          break;
        case "rect":
          commit({ kind: "rect", a: pending, b: { time, price: num } });
          break;
        case "fib":
          commit({ kind: "fib", a: pending, b: { time, price: num } });
          break;
      }
    };
    chart.subscribeClick(onClick);

    // --- Drawing preview on crosshair move -------------------------------
    // While the user has a pending anchor, render a ghost shape from the
    // anchor to the current crosshair position. Only fires the primitive
    // refresh when the preview actually changes — chart sends crosshair
    // events on raw mouse moves, several per second.
    const onCrosshair = (param: MouseEventParams) => {
      const t = toolRef.current;
      const pending = drawingPendingPointRef.current;
      if (!pending) return;
      if (!param.point || param.time == null) return;
      const series = candleSeriesRef.current;
      if (!series) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const time = param.time as UTCTimestamp;
      const num = Number(price);
      let next: DrawingShape | null = null;
      if (t === "trendline") next = { kind: "trendline", a: pending, b: { time, price: num } };
      else if (t === "rect") next = { kind: "rect", a: pending, b: { time, price: num } };
      else if (t === "fib") next = { kind: "fib", a: pending, b: { time, price: num } };
      if (next === drawingPreviewRef.current) return;
      drawingPreviewRef.current = next;
      pushDrawingsToPrimitive();
    };
    chart.subscribeCrosshairMove(onCrosshair);

    function pushDrawingsToPrimitive() {
      const prim = drawingPrimitiveRef.current;
      if (!prim) return;
      prim.setState({
        drawings: drawingsRef.current,
        preview: drawingPreviewRef.current,
      });
    }

    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el || !chartRef.current) return;
      chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      oracleSeriesRef.current = null;
      priceLinesRef.current = [];
      drawingPrimitiveRef.current = null;
      maSeriesRef.current = null;
      emaSeriesRef.current = null;
      rsiSeriesRef.current = null;
    };
    // Intentionally no deps — chart is reused across data/theme updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const t = readThemeTokens();
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
      // Cache closes for indicator math + recompute any active overlays.
      closesRef.current = candleData.map((c) => ({ time: c.time, close: c.close }));
      refreshIndicatorSeriesRef.current?.();
      setChartStatus(candles.length > 0 ? "ready" : "empty");

      // Restore persisted drawings for this (market, timeframe). The active
      // pair just (possibly) changed, so we wipe any in-memory drawings
      // belonging to the previous pair and rehydrate from localStorage.
      const restored = loadDrawings(market.sym, timeframe);
      drawingsRef.current = restored;
      drawingPreviewRef.current = null;
      drawingPendingPointRef.current = null;
      drawingPrimitiveRef.current?.setState({
        drawings: restored,
        preview: null,
      });

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

  // PriceLines — recreated whenever the prop bag changes. Cheap; only 1–3 lines.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const t = readThemeTokens();
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
  }, [entryPrice, liquidationPrice, markPrice]);

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
    // Keep the closes cache + indicators in lockstep with the live tick.
    // Append a new bar OR mutate the last close in place to match what
    // the candle series itself just did.
    const closes = closesRef.current;
    if (closes.length > 0 && closes[closes.length - 1].time === (next.time as UTCTimestamp)) {
      closes[closes.length - 1] = { time: next.time as UTCTimestamp, close: next.c };
    } else {
      closes.push({ time: next.time as UTCTimestamp, close: next.c });
    }
    refreshIndicatorSeriesRef.current?.();
  }, [liveSource, live.tick]);

  // --- Indicators ------------------------------------------------------
  //
  // The chart owns a tiny "refresh fn" stored on a ref so other effects
  // (historical load, live tick) can re-evaluate the indicator overlays
  // without depending on the indicator state itself. The actual series
  // create/destroy lifecycle lives in the effect below, which fires when
  // an indicator toggles or its period changes.
  const refreshIndicatorSeriesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const t = readThemeTokens();

    const ensureSeries = (
      ref: MutableRefObject<ISeriesApi<"Line"> | null>,
      color: string,
      paneIndex: number,
      visible: boolean,
    ) => {
      if (visible) {
        if (!ref.current) {
          // v5 supports a 3rd `paneIndex` arg on addSeries to push the
          // series into its own pane. Pane 1 didn't exist before this
          // call — the chart will create it on demand and split the
          // canvas. There's no explicit "delete pane" API; removing
          // the last series in the pane is enough to collapse it.
          ref.current = chart.addSeries(
            LineSeries,
            {
              color,
              lineWidth: 2,
              lastValueVisible: true,
              priceLineVisible: false,
              crosshairMarkerVisible: false,
            },
            paneIndex,
          );
        }
      } else if (ref.current) {
        chart.removeSeries(ref.current);
        ref.current = null;
      }
    };

    ensureSeries(maSeriesRef, t.primary, 0, indicators.ma.enabled);
    ensureSeries(emaSeriesRef, t.profitInk, 0, indicators.ema.enabled);
    ensureSeries(rsiSeriesRef, t.lossInk, 1, indicators.rsi.enabled);

    const refresh = () => {
      const closes = closesRef.current;
      if (closes.length === 0) return;
      if (maSeriesRef.current && indicators.ma.enabled) {
        maSeriesRef.current.setData(computeMA(closes, indicators.ma.period));
      }
      if (emaSeriesRef.current && indicators.ema.enabled) {
        emaSeriesRef.current.setData(computeEMA(closes, indicators.ema.period));
      }
      if (rsiSeriesRef.current && indicators.rsi.enabled) {
        rsiSeriesRef.current.setData(computeRSI(closes, indicators.rsi.period));
      }
    };
    refreshIndicatorSeriesRef.current = refresh;
    refresh();

    return () => {
      // Effect cleanup runs before the next indicator change. Don't tear
      // down the series here — the next run will reconcile via ensureSeries.
      // Only clear the refresh fn so a fresh closure is installed.
      refreshIndicatorSeriesRef.current = null;
    };
  }, [
    indicators.ma.enabled,
    indicators.ma.period,
    indicators.ema.enabled,
    indicators.ema.period,
    indicators.rsi.enabled,
    indicators.rsi.period,
  ]);

  // --- Eraser ----------------------------------------------------------
  // Triggered by the toolbar's "clear all" button (counter on the store).
  // Wipes drawings for the active (market, timeframe) in-memory and in
  // localStorage; ignores the first render (clearTick = 0).
  const prevClearTickRef = useRef(0);
  useEffect(() => {
    if (clearTick === 0) return;
    if (clearTick === prevClearTickRef.current) return;
    prevClearTickRef.current = clearTick;
    drawingsRef.current = [];
    drawingPreviewRef.current = null;
    drawingPendingPointRef.current = null;
    const { sym, tf } = persistKeyRef.current;
    saveDrawings(sym, tf, []);
    drawingPrimitiveRef.current?.setState({ drawings: [], preview: null });
  }, [clearTick]);

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
  const toolClass = tool === "cursor" ? "" : ` chart-tool-${tool}`;
  return (
    <div ref={containerRef} className={`chart-area${toolClass}`}>
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
