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
import type { Market } from "./data";

export interface CandleChartProps {
  market: Market;
  timeframe: string;
  /** Defaults to `'mock'` until Sprint A wires ponder + Sprint E wires WS. */
  source?: CandleSource;
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

export function CandleChart({
  market,
  timeframe,
  source = "mock",
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
  const [hover, setHover] = useState<Candle | null>(null);

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

  // Data load — re-fetches on market/timeframe/source change.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const candles = await getCandles({
        source,
        marketId: market.sym,
        tf: timeframe,
        basePrice: market.price,
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
  }, [market.sym, market.price, timeframe, source, oracleLine]);

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
    </div>
  );
}
