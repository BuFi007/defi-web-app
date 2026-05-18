/**
 * Typed candle source adapter — Sprint D.
 *
 * The chart component should never call `fetch` or `makeCandles` directly; it
 * delegates to `getCandles({ source })` so the same UI works against:
 *   - mock      synthetic data (current `makeCandles` in data.tsx)
 *   - ponder    `GET /api/perps/candles/:marketId?tf=15m` (not live yet)
 *   - websocket realtime stream (Sprint E)
 */

export type CandleSource = "mock" | "ponder" | "websocket";

export type Candle = {
  /** Unix epoch in **seconds** — lightweight-charts UTCTimestamp shape. */
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export interface GetCandlesOptions {
  source: CandleSource;
  marketId: string;
  tf: string;
  /** Defaults to 200 — enough to fill the viewport at any tf without overdraw. */
  limit?: number;
  /** Mid/seed price for mock fixture; used only when `source === 'mock'`. */
  basePrice?: number;
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
  /** Base URL for ponder reads; defaults to relative `/api`. */
  apiBaseUrl?: string;
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1H": 60 * 60,
  "4H": 4 * 60 * 60,
  "1D": 24 * 60 * 60,
  "1W": 7 * 24 * 60 * 60,
};

export function timeframeToSeconds(tf: string): number {
  return TF_SECONDS[tf] ?? TF_SECONDS["15m"];
}

export async function getCandles(opts: GetCandlesOptions): Promise<Candle[]> {
  const { source } = opts;
  if (source === "mock") return makeMockCandles(opts);
  if (source === "ponder") return fetchPonderCandles(opts);
  if (source === "websocket") {
    // Sprint E will replace this with a streaming subscription; the chart
    // component falls back to mock so the surface never goes blank.
    console.warn("[market-data] websocket source not implemented; returning mock");
    return makeMockCandles(opts);
  }
  return [];
}

// Pure deterministic generator so re-renders don't re-shuffle the chart.
// Matches the visual character of the legacy `makeCandles` in
// apps/web/components/trade-island/data.tsx — we keep both so neither owner
// breaks the other.
export function makeMockCandles({
  marketId,
  tf,
  limit = 200,
  basePrice,
}: Pick<GetCandlesOptions, "marketId" | "tf" | "limit" | "basePrice">): Candle[] {
  const count = limit;
  const base = basePrice ?? 1;
  const out: Candle[] = [];
  let p = base * 0.985;
  let seed = Math.abs(hashString(marketId + tf)) || Math.floor(base * 1000) || 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const stepSec = timeframeToSeconds(tf);
  const nowSec = Math.floor(Date.now() / 1000);
  const start = nowSec - stepSec * (count - 1);
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.45) * base * 0.004;
    const o = p;
    const c = p + drift;
    const h = Math.max(o, c) + rand() * base * 0.003;
    const l = Math.min(o, c) - rand() * base * 0.003;
    const v = rand() * 1000 + 200;
    out.push({ time: start + i * stepSec, o, h, l, c, v });
    p = c;
  }
  if (out.length) {
    const lastSpread = base * 0.002;
    const last = out[out.length - 1];
    last.c = base;
    last.h = Math.max(last.h, base + lastSpread * 0.3);
    last.l = Math.min(last.l, base - lastSpread * 0.3);
  }
  return out;
}

async function fetchPonderCandles(opts: GetCandlesOptions): Promise<Candle[]> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) {
    console.warn("[market-data] no fetch impl available; returning empty");
    return [];
  }
  const base = opts.apiBaseUrl ?? "/api";
  const url = `${base}/perps/candles/${encodeURIComponent(opts.marketId)}?tf=${encodeURIComponent(opts.tf)}${
    opts.limit ? `&limit=${opts.limit}` : ""
  }`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      console.warn(`[market-data] /perps/candles ${res.status}; returning empty`);
      return [];
    }
    const json = (await res.json()) as { candles?: Candle[] } | Candle[];
    const arr = Array.isArray(json) ? json : json.candles ?? [];
    // Defensive normalization — ponder may emit ms timestamps; lightweight-charts
    // wants seconds.
    return arr.map((c) => ({
      ...c,
      time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
    }));
  } catch (err) {
    console.warn("[market-data] /perps/candles fetch failed; returning empty", err);
    return [];
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
