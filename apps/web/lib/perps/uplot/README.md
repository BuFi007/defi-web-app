# uPlot wrappers

This folder hosts the React lifecycle adapter for [uPlot](https://github.com/leeoniya/uPlot),
plus the format helpers that translate BuFi's 1e18-scaled bigints onto
plain `number[]`s for uPlot's canvas.

## Why uPlot

The trade tab needed a chart engine for:

- Cumulative-depth visualisation against a 5–10 Hz orderbook stream
- Funding-rate sparklines with 96+ samples per market
- Future open-interest history sparklines, traded volume strips, etc.

Three libraries were on the table:

| lib                       | bundle (gz) | render @5k pts  | notes                                                                                                                                  |
| ------------------------- | ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Recharts                  | ~96 KB      | 30–40 ms        | Pure-React DOM-tree per data point. Janks on book deltas above ~500 levels.                                                            |
| D3 (with custom render)   | ~85 KB core | 5–8 ms          | Lots of code we'd own. No first-class canvas helpers — every chart is a custom implementation.                                         |
| **uPlot**                 | **~37 KB**  | **0.5–1.5 ms**  | Canvas-backed, vanilla JS, single dependency-free file. The `setData()` fast path is what unlocks 60fps under live WS feeds.           |

uPlot is the only one of the three that survives a 5000-point series at
60fps in the DevTools Performance recorder. Lightweight Charts (already
in use for candles) is bigger (~140 KB gz) and only specialises in OHLC
— the wrong tool for depth + sparklines.

## The imperative-to-React wrapping pattern

uPlot's API is fully imperative: `new uPlot(opts, data, host)`. The
naive React wrapper recreates the instance on every render, which
defeats the whole point of the library. The right shape is:

```ts
const { containerRef } = useUplot({ opts, data });
return <div ref={containerRef} style={{ width: "100%", height: 120 }} />;
```

Inside `useUplot`:

- `useEffect` with `[optsKey]` deps creates the uPlot instance once.
- A second `useEffect` with `[data]` deps calls `instance.setData(data)`
  without touching the rest of the chart.
- `ResizeObserver` drives `instance.setSize({ width, height })`.

`optsKey` is the escape hatch — if you genuinely need to swap axes or
add a series, change the key and the hook tears down and rebuilds.

## Series + paths reference

The depth chart uses uPlot's stepped path builder for the staircase
look traders expect:

```ts
{
  paths: uPlot.paths.stepped({ align: 1 }), // 1 = "right edge"
  points: { show: false },
}
```

The funding sparkline uses the default linear path:

```ts
{
  paths: undefined,           // uPlot's default linear interpolation
  points: { show: false },    // pure curve, no markers
}
```

For per-series color, set `stroke: "#abc"` (single colour) or pass a
function `(self, seriesIdx) => CanvasFillStrokeStyles["strokeStyle"]`
for theming. BuFi reads `--profit-ink` / `--loss-ink` from the active
theme via `getComputedStyle(document.documentElement)` inside the
component.

## What this folder owns

- `use-uplot.ts`   — lifecycle hook
- `format.ts`      — bigint-e18 → number, plus depth/funding formatters
- `uplot.css`      — uPlot's stylesheet + BuFi theme overrides
- `index.ts`       — barrel + CSS side-effect

What it does NOT own:

- The orderbook stream subscription — lives in
  `apps/web/lib/perps/use-live-market.ts` (already exposes `obDelta`).
- The funding-rate read — lives in `apps/web/lib/perps/use-funding-rate.ts`.
- The depth component itself — lives next to the consumers at
  `apps/web/components/trade-island/depth.tsx`.
