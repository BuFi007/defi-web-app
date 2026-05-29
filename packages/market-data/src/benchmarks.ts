/**
 * Pyth Benchmarks (TradingView UDF shim) historical OHLCV fetcher.
 *
 * Pyth Hermes streams LIVE ticks. For historical candles the public surface
 * is the Benchmarks "tradingview/history" shim at
 *   https://benchmarks.pyth.network/v1/shims/tradingview/history
 *
 * Response shape: TradingView UDF — { s, t[], o[], h[], l[], c[] }.
 * `v` is absent for FX feeds (no traded volume); we synthesize a
 * volume proxy from per-bar price-change magnitude so the chart's volume
 * histogram has something to draw. The proxy is cosmetic and clearly
 * labeled in callers.
 *
 * Resolution string is TradingView UDF format — minutes for intraday
 * ("1", "5", "15", "60", "240"), "D" / "W" / "M" for higher tfs.
 */

import type { Candle } from "./candles";

export const BENCHMARKS_DEFAULT_BASE_URL = "https://benchmarks.pyth.network";

/** Map a UI timeframe string (matching trade-island data.tsx tfs) to a
 *  Pyth Benchmarks resolution token. */
export function tfToBenchmarksResolution(tf: string): string {
  switch (tf) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "1H":
      return "60";
    case "4H":
      return "240";
    case "1D":
      return "D";
    case "1W":
      return "W";
    default:
      return "15";
  }
}

/** Same map flipped to seconds — used to compute the `from` lower bound. */
export function tfToSeconds(tf: string): number {
  const m: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1H": 3600,
    "4H": 14400,
    "1D": 86400,
    "1W": 604800,
  };
  return m[tf] ?? 900;
}

/** Map a UI symbol (e.g. "EUR/USD", "JPY/USD", "MXN/USD") to the Pyth
 *  Benchmarks ticker. Returns null when no mapping is known — caller
 *  should fall back to empty candles + a "no historical data" toast. */
export function pythBenchmarksSymbol(uiSymbol: string): string | null {
  const norm = uiSymbol.toUpperCase().replace(/\s+/g, "");
  // FX pairs ship as FX.AAA/BBB.
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(norm)) {
    return `FX.${norm}`;
  }
  // Crypto pairs (BTC-PERP, ETH-PERP) — strip the suffix, append /USD.
  const cryptoMatch = norm.match(/^([A-Z]{3,5})(?:-PERP|\/USD)?$/);
  if (cryptoMatch) {
    return `Crypto.${cryptoMatch[1]}/USD`;
  }
  return null;
}

export interface FetchBenchmarksHistoryOptions {
  uiSymbol: string;
  /** Timeframe string matching trade-island data.tsx (e.g. "15m"). */
  tf: string;
  /** Max candles to return (caps the [from, to] window). Default 200. */
  limit?: number;
  /** Optional unix-second lower bound. Omitted means "derive from limit". */
  from?: number;
  /** Optional unix-second upper bound. Omitted means "now". */
  to?: number;
  /** Override base URL — env-controlled in apps/api via PYTH_BENCHMARKS_URL. */
  baseUrl?: string;
  /** Test injection for fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch historical OHLCV from Pyth Benchmarks for a UI symbol + timeframe.
 *
 * Returns an array sorted oldest→newest (lightweight-charts requires
 * ascending time). Returns [] on any failure so the caller can degrade
 * gracefully (chart shows the live-tail only).
 *
 * Throws on programmer error (unmappable symbol with the `strict` flag
 * set) — production callers should not pass `strict: true`.
 */
export async function fetchBenchmarksHistory(
  opts: FetchBenchmarksHistoryOptions,
): Promise<Candle[]> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return [];
  const ticker = pythBenchmarksSymbol(opts.uiSymbol);
  if (!ticker) return [];
  const baseUrl = opts.baseUrl ?? BENCHMARKS_DEFAULT_BASE_URL;
  const resolution = tfToBenchmarksResolution(opts.tf);
  const requestedLimit = Math.max(1, Math.floor(opts.limit ?? 200));
  const tfSec = tfToSeconds(opts.tf);
  // Pyth Benchmarks rejects FX queries that span > 1 year with
  // `{"s":"error","errmsg":"Requested range exceeds 1 year"}`. Asking
  // for 200 weekly bars naturally wants 5+ years — the response is
  // empty and the chart stays in its loading overlay forever. Cap at
  // 360 days to stay safely under the 365-day server-side limit AND
  // shrink the effective limit so weekly/daily tfs don't over-request.
  const MAX_LOOKBACK_SEC = 360 * 86400; // ~12 months — fits Pyth FX limit
  const naturalLookback = Math.ceil(tfSec * requestedLimit * 1.4);
  const now = Math.floor(Date.now() / 1000);
  const to = Math.min(
    Math.floor(Number.isFinite(opts.to) ? opts.to! : now),
    now + tfSec,
  );
  let from = Number.isFinite(opts.from)
    ? Math.floor(opts.from!)
    : to - Math.min(naturalLookback, MAX_LOOKBACK_SEC);
  if (to - from > MAX_LOOKBACK_SEC) from = to - MAX_LOOKBACK_SEC;
  if (from >= to) from = to - tfSec;
  // If the default tail query was capped, recompute the effective limit
  // so the tail-cap at the end still produces a sane window. Explicit
  // cursor windows keep the caller's requested limit.
  const limit = opts.from == null && opts.to == null && naturalLookback > MAX_LOOKBACK_SEC
    ? Math.max(1, Math.floor(MAX_LOOKBACK_SEC / Math.ceil(tfSec * 1.4)))
    : requestedLimit;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/shims/tradingview/history?symbol=${encodeURIComponent(
    ticker,
  )}&resolution=${resolution}&from=${from}&to=${to}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      s?: string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
      v?: number[];
    };
    if (json.s !== "ok" || !json.t || !json.o || !json.h || !json.l || !json.c) {
      return [];
    }
    const len = json.t.length;
    // Pyth Benchmarks SHIPS `v` for FX symbols too, but it's an array of
    // zeros (FX has no traded volume on a public tape). The previous
    // `json.v?.[i] ?? synth` only fired the synth fallback on undefined,
    // so FX pairs got v=0 across the board -> compute24hStats summed to
    // 0 -> 24h Vol displayed as $0.00. Detect "v is structurally empty"
    // once per fetch and ignore it so the synth proxy engages.
    const vSource = json.v;
    const vIsAllZero =
      Array.isArray(vSource) && vSource.length > 0 && vSource.every((x) => !x);
    const useSynthVolume = !vSource || vIsAllZero;
    const candles: Candle[] = [];
    for (let i = 0; i < len; i++) {
      const o = json.o[i] ?? 0;
      const c = json.c[i] ?? 0;
      // Per-bar absolute change scaled into the same magnitude as crypto
      // tape volume (~10^4-10^5 USD), so the chart's histogram has shape
      // without overwhelming the candles. Crypto pairs with real `v`
      // keep their feed values untouched.
      const synth = Math.abs(c - o) * 100_000;
      const v = useSynthVolume ? synth : vSource?.[i] ?? synth;
      candles.push({
        time: json.t[i]!,
        o,
        h: json.h[i] ?? o,
        l: json.l[i] ?? o,
        c,
        v,
      });
    }
    // Tail-cap to `limit` so the caller gets the most-recent window
    // when Benchmarks returns more (typical because of the 1.4× pad).
    return candles.length > limit ? candles.slice(-limit) : candles;
  } catch {
    return [];
  }
}

/** Compute 24h high / low / volume from an array of intraday candles.
 *  Assumes `candles` is sorted oldest→newest. Returns null fields when
 *  the input is empty. */
export function compute24hStats(candles: readonly Candle[]): {
  high: number | null;
  low: number | null;
  volume: number | null;
  open: number | null;
  close: number | null;
  changePct: number | null;
} {
  if (candles.length === 0) {
    return { high: null, low: null, volume: null, open: null, close: null, changePct: null };
  }
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 24 * 3600;
  const window = candles.filter((c) => c.time >= cutoff);
  const slice = window.length > 0 ? window : candles;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const c of slice) {
    if (c.h > high) high = c.h;
    if (c.l < low) low = c.l;
    volume += c.v;
  }
  const open = slice[0]!.o;
  const close = slice[slice.length - 1]!.c;
  const changePct = open !== 0 ? ((close - open) / open) * 100 : 0;
  return { high, low, volume, open, close, changePct };
}
