"use client";

/**
 * Binance-style left-rail toolbar for the trade chart.
 *
 * Owns two pieces of state for the chart:
 *   1. `tool` — which drawing tool is currently armed. The chart component
 *      reads this on every click; "cursor" is the no-op default.
 *   2. `indicators` — flags + periods for the technical overlays the chart
 *      renders (MA, EMA, RSI).
 *
 * Both pieces of state are persisted to localStorage so the trader's chart
 * setup survives a reload. The store lives in this file so chart.tsx can
 * import the hook + selectors without a circular dep on the toolbar UI.
 *
 * State management pattern matches `lib/session/store.ts` — zustand with
 * selector hooks. Persistence is hand-rolled (no `zustand/persist`) so we
 * keep the dep surface tight; persisting indicators requires only a couple
 * of integer flags + periods.
 *
 * Drawing primitives are NOT stored in zustand — they're per-market /
 * per-timeframe and would bloat the store. The chart owns its own per-pair
 * `Drawing[]` ref and persists to localStorage keyed by `marketSym|tf`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { Icon } from "./data";

export type DrawingTool =
  | "cursor"
  | "trendline"
  | "hline"
  | "vline"
  | "rect"
  | "fib"
  | "text";

export interface ChartIndicators {
  ma: { enabled: boolean; period: number };
  ema: { enabled: boolean; period: number };
  rsi: { enabled: boolean; period: number };
}

interface ChartToolbarState {
  tool: DrawingTool;
  indicators: ChartIndicators;
  /** Bumped each time the user hits the eraser. The chart subscribes to
   *  this and clears its in-memory drawings + persisted storage for the
   *  active (market, timeframe) pair. A counter is simpler than a one-shot
   *  flag since multiple clicks in a row need to dispatch multiple clears. */
  clearTick: number;
}

interface ChartToolbarActions {
  setTool(tool: DrawingTool): void;
  toggleIndicator(name: keyof ChartIndicators): void;
  setIndicatorPeriod(name: keyof ChartIndicators, period: number): void;
  triggerClearAll(): void;
}

const INDICATOR_DEFAULTS: ChartIndicators = {
  ma: { enabled: false, period: 20 },
  ema: { enabled: false, period: 50 },
  rsi: { enabled: false, period: 14 },
};

const INDICATORS_LS_KEY = "bufi.chart.indicators.v1";

// Hydrate from localStorage on first load — SSR-safe via the typeof guard.
function readPersistedIndicators(): ChartIndicators {
  if (typeof window === "undefined") return INDICATOR_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(INDICATORS_LS_KEY);
    if (!raw) return INDICATOR_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChartIndicators>;
    return {
      ma: { ...INDICATOR_DEFAULTS.ma, ...(parsed.ma ?? {}) },
      ema: { ...INDICATOR_DEFAULTS.ema, ...(parsed.ema ?? {}) },
      rsi: { ...INDICATOR_DEFAULTS.rsi, ...(parsed.rsi ?? {}) },
    };
  } catch {
    return INDICATOR_DEFAULTS;
  }
}

function persistIndicators(ind: ChartIndicators) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INDICATORS_LS_KEY, JSON.stringify(ind));
  } catch {
    /* quota / disabled storage — ignore silently */
  }
}

export const useChartToolbarStore = create<
  ChartToolbarState & ChartToolbarActions
>((set, get) => ({
  tool: "cursor",
  indicators: readPersistedIndicators(),
  clearTick: 0,
  setTool(tool) {
    set({ tool });
  },
  toggleIndicator(name) {
    const cur = get().indicators;
    const next: ChartIndicators = {
      ...cur,
      [name]: { ...cur[name], enabled: !cur[name].enabled },
    };
    set({ indicators: next });
    persistIndicators(next);
  },
  setIndicatorPeriod(name, period) {
    const safe = Math.max(2, Math.min(500, Math.floor(period) || 0));
    const cur = get().indicators;
    const next: ChartIndicators = {
      ...cur,
      [name]: { ...cur[name], period: safe },
    };
    set({ indicators: next });
    persistIndicators(next);
  },
  triggerClearAll() {
    set({ clearTick: get().clearTick + 1 });
  },
}));

// Selectors — pattern mirrors lib/session/store.ts so React only re-renders
// the subscribed slice.
export const selectTool = (s: ChartToolbarState) => s.tool;
export const selectIndicators = (s: ChartToolbarState) => s.indicators;
export const selectClearTick = (s: ChartToolbarState) => s.clearTick;

// --- UI ---------------------------------------------------------------

interface ToolDef {
  id: DrawingTool | "eraser" | "indicators";
  icon: string;
  label: string;
  hint: string;
}

const TOOLS: ToolDef[] = [
  { id: "cursor", icon: "cursor", label: "Cursor", hint: "Cursor (no drawing tool)" },
  { id: "trendline", icon: "trendline", label: "Trend line", hint: "Trend line — click two points" },
  { id: "hline", icon: "hline", label: "Horizontal", hint: "Horizontal line — click once" },
  { id: "vline", icon: "vline", label: "Vertical", hint: "Vertical line — click once" },
  { id: "rect", icon: "rect", label: "Rectangle", hint: "Rectangle — click two corners" },
  { id: "fib", icon: "fib", label: "Fibonacci", hint: "Fibonacci retracement — click two points" },
  { id: "text", icon: "text", label: "Text", hint: "Text annotation — click once, type, Enter" },
];

export function ChartToolbar() {
  const tool = useChartToolbarStore(selectTool);
  const indicators = useChartToolbarStore(selectIndicators);
  const setTool = useChartToolbarStore((s) => s.setTool);
  const triggerClearAll = useChartToolbarStore((s) => s.triggerClearAll);
  const toggleIndicator = useChartToolbarStore((s) => s.toggleIndicator);
  const setIndicatorPeriod = useChartToolbarStore((s) => s.setIndicatorPeriod);

  const [indicatorOpen, setIndicatorOpen] = useState(false);
  const indicatorRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside click. Cheap — only mounted while open.
  useEffect(() => {
    if (!indicatorOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (!indicatorRef.current) return;
      if (!indicatorRef.current.contains(ev.target as Node)) {
        setIndicatorOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [indicatorOpen]);

  const indicatorEnabledCount = useMemo(
    () =>
      [indicators.ma, indicators.ema, indicators.rsi].filter((x) => x.enabled)
        .length,
    [indicators],
  );

  return (
    <div className="chart-toolbar" role="toolbar" aria-label="Chart drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={"chart-tool-btn" + (tool === t.id ? " active" : "")}
          onClick={() => setTool(t.id as DrawingTool)}
          aria-pressed={tool === t.id}
          aria-label={t.label}
          title={t.hint}
        >
          <Icon name={t.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className="chart-tool-btn"
        onClick={triggerClearAll}
        aria-label="Clear all drawings"
        title="Clear all drawings on this market+timeframe"
      >
        <Icon name="eraser" size={16} />
      </button>
      <div className="chart-toolbar-divider" aria-hidden />
      <div className="chart-toolbar-indicator-wrap" ref={indicatorRef}>
        <button
          type="button"
          className={
            "chart-tool-btn" + (indicatorEnabledCount > 0 ? " accent" : "")
          }
          onClick={() => setIndicatorOpen((v) => !v)}
          aria-label="Technical indicators"
          aria-expanded={indicatorOpen}
          title={`Indicators${indicatorEnabledCount > 0 ? ` (${indicatorEnabledCount} active)` : ""}`}
        >
          <Icon name="indicator" size={16} />
          {indicatorEnabledCount > 0 && (
            <span className="chart-tool-badge" aria-hidden>
              {indicatorEnabledCount}
            </span>
          )}
        </button>
        {indicatorOpen && (
          <div className="chart-indicator-popover" role="dialog" aria-label="Technical indicators">
            <div className="chart-indicator-head">Indicators</div>
            <IndicatorRow
              label="MA"
              color="var(--primary)"
              enabled={indicators.ma.enabled}
              period={indicators.ma.period}
              onToggle={() => toggleIndicator("ma")}
              onPeriodChange={(n) => setIndicatorPeriod("ma", n)}
              hint="Simple moving average"
            />
            <IndicatorRow
              label="EMA"
              color="var(--profit-ink)"
              enabled={indicators.ema.enabled}
              period={indicators.ema.period}
              onToggle={() => toggleIndicator("ema")}
              onPeriodChange={(n) => setIndicatorPeriod("ema", n)}
              hint="Exponential moving average"
            />
            <IndicatorRow
              label="RSI"
              color="var(--loss-ink)"
              enabled={indicators.rsi.enabled}
              period={indicators.rsi.period}
              onToggle={() => toggleIndicator("rsi")}
              onPeriodChange={(n) => setIndicatorPeriod("rsi", n)}
              hint="Relative strength index — renders in a separate pane"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function IndicatorRow({
  label,
  color,
  enabled,
  period,
  onToggle,
  onPeriodChange,
  hint,
}: {
  label: string;
  color: string;
  enabled: boolean;
  period: number;
  onToggle(): void;
  onPeriodChange(n: number): void;
  hint: string;
}) {
  return (
    <div className="chart-indicator-row" title={hint}>
      <label className="chart-indicator-toggle">
        <input type="checkbox" checked={enabled} onChange={onToggle} />
        <span className="chart-indicator-dot" style={{ background: color }} />
        <span className="chart-indicator-name">{label}</span>
      </label>
      <input
        type="number"
        className="chart-indicator-period"
        value={period}
        min={2}
        max={500}
        step={1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onPeriodChange(n);
        }}
        aria-label={`${label} period`}
      />
    </div>
  );
}
