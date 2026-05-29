import type { Candle } from "./candles";

export const FRANKFURTER_DEFAULT_BASE_URL = "https://api.frankfurter.dev";

export interface FetchFrankfurterDailyHistoryOptions {
  uiSymbol: string;
  /** Max daily candles to return. Default 500. */
  limit?: number;
  /** Optional unix-second lower bound. Omitted means "derive from limit". */
  from?: number;
  /** Optional unix-second upper bound. Omitted means "now". */
  to?: number;
  /** Override base URL, e.g. self-hosted Frankfurter. */
  baseUrl?: string;
  /** Test injection for fetch. */
  fetchImpl?: typeof fetch;
}

type FrankfurterRateRow = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

function fxPair(uiSymbol: string): { base: string; quote: string } | null {
  const norm = uiSymbol.toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{3})\/([A-Z]{3})$/.exec(norm);
  if (!match) return null;
  return { base: match[1]!, quote: match[2]! };
}

function utcDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function dateToUnixSeconds(date: string): number | null {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

/**
 * Daily FX history from Frankfurter v2. This is intentionally a coarse,
 * old-history fallback for chart continuity when Pyth Benchmarks has no
 * archive page for an FX pair. It should not replace recent/intraday Pyth
 * candles.
 */
export async function fetchFrankfurterDailyHistory(
  opts: FetchFrankfurterDailyHistoryOptions,
): Promise<Candle[]> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return [];
  const pair = fxPair(opts.uiSymbol);
  if (!pair) return [];

  const limit = Math.max(1, Math.floor(opts.limit ?? 500));
  const now = Math.floor(Date.now() / 1000);
  const to = Math.min(
    Math.floor(Number.isFinite(opts.to) ? opts.to! : now),
    now,
  );
  const maxLookback = limit * 86400;
  let from = Number.isFinite(opts.from)
    ? Math.floor(opts.from!)
    : to - maxLookback;
  if (to - from > maxLookback) from = to - maxLookback;
  if (from >= to) from = to - 86400;

  const url = new URL("/v2/rates", opts.baseUrl ?? FRANKFURTER_DEFAULT_BASE_URL);
  url.searchParams.set("base", pair.base);
  url.searchParams.set("quotes", pair.quote);
  url.searchParams.set("from", utcDate(from));
  url.searchParams.set("to", utcDate(to));

  try {
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const rows = (await res.json()) as FrankfurterRateRow[];
    if (!Array.isArray(rows)) return [];
    const candles: Candle[] = [];
    let prevClose: number | null = null;
    for (const row of rows) {
      if (row.base !== pair.base || row.quote !== pair.quote) continue;
      if (typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0) {
        continue;
      }
      if (!row.date) continue;
      const time = dateToUnixSeconds(row.date);
      if (time == null) continue;
      const o = prevClose ?? row.rate;
      const c = row.rate;
      candles.push({
        time,
        o,
        h: Math.max(o, c),
        l: Math.min(o, c),
        c,
        v: Math.abs(c - o) * 100_000,
      });
      prevClose = c;
    }
    return candles.length > limit ? candles.slice(-limit) : candles;
  } catch {
    return [];
  }
}
