/**
 * Analytics read endpoints. Thin proxies in front of Tinybird's
 * `/v0/pipes/<name>.json` endpoints. Heavy CDN caching via
 * `Cache-Control: max-age=15, stale-while-revalidate=60` so the
 * leaderboard / OHLCV / OI / funding panels stay sub-second under
 * fan-out.
 *
 * When `TINYBIRD_READ_TOKEN` is unset every endpoint returns
 * `{ data: [], analyticsAvailable: false, reason: "..." }` with a 200
 * — the web client renders an "analytics warming up" placeholder
 * rather than the app blowing up.
 *
 * Schemas: all amount columns are int64 atomic units encoded as JSON
 * numbers (Tinybird default). Clients convert with the same
 * `formatAtomicToUsdc` / e18 helpers used everywhere else.
 */
import { Hono } from "hono";

import { jsonError } from "../helpers";

/** Pipes whitelisted for proxy. Keep in sync with `/tinybird/pipes/`. */
const PIPES = {
  leaderboard: "leaderboard_by_pnl",
  marketVolume: "market_24h_volume",
  ohlcv: "ohlcv_by_market",
  funding: "funding_history",
  oi: "oi_history",
  traderCounts: "trade_count_by_trader",
} as const;

type PipeName = (typeof PIPES)[keyof typeof PIPES];

const READ_CACHE_HEADER = "max-age=15, stale-while-revalidate=60";

function tinybirdReadBaseUrl(): string {
  const region = (process.env.TINYBIRD_REGION ?? "us-east-1").toLowerCase();
  if (region === "eu") return "https://api.eu-central-1.aws.tinybird.co";
  if (region === "gcp-europe-west2" || region === "europe-west2") {
    return "https://api.europe-west2.gcp.tinybird.co";
  }
  return "https://api.tinybird.co";
}

interface TinybirdResponse<TRow> {
  data: TRow[];
  rows?: number;
  rows_before_limit_at_least?: number;
  meta?: Array<{ name: string; type: string }>;
}

/** Shape of every public analytics response. Keeps the web client
 *  uniform: it can always read `data` + `analyticsAvailable` + meta. */
interface AnalyticsEnvelope<TRow> {
  data: TRow[];
  analyticsAvailable: boolean;
  reason?: string;
  cachedAt: number;
  source: "tinybird" | "disabled";
  pipe: PipeName | null;
}

function emptyEnvelope(pipe: PipeName, reason: string): AnalyticsEnvelope<never> {
  return {
    data: [],
    analyticsAvailable: false,
    reason,
    cachedAt: Date.now(),
    source: "disabled",
    pipe,
  };
}

async function proxyPipe<TRow>(
  pipe: PipeName,
  params: Record<string, string | number | undefined>,
): Promise<AnalyticsEnvelope<TRow>> {
  const token = process.env.TINYBIRD_READ_TOKEN;
  if (!token) {
    return emptyEnvelope(pipe, "TINYBIRD_READ_TOKEN is unset") as AnalyticsEnvelope<TRow>;
  }

  const url = new URL(`${tinybirdReadBaseUrl()}/v0/pipes/${pipe}.json`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      data: [],
      analyticsAvailable: false,
      reason: `tinybird ${res.status}: ${text.slice(0, 200)}`,
      cachedAt: Date.now(),
      source: "disabled",
      pipe,
    } as AnalyticsEnvelope<TRow>;
  }

  const body = (await res.json()) as TinybirdResponse<TRow>;
  return {
    data: body.data ?? [],
    analyticsAvailable: true,
    cachedAt: Date.now(),
    source: "tinybird",
    pipe,
  };
}

// ---------- Response row types (kept inline so the web client can
// import them via `apps/api/src/routes/analytics.ts`). ----------

export interface LeaderboardRow {
  trader: string;
  realized_pnl: number;
  trade_count: number;
  markets_traded: number;
  first_trade_at: string;
  last_trade_at: string;
}

export interface MarketVolumeRow {
  market_id: string;
  volume_usdc: number;
  fees_usdc: number;
  trade_count: number;
  unique_takers: number;
  unique_makers: number;
}

export interface OhlcvRow {
  bar_start: string;
  open_e18: number;
  high_e18: number;
  low_e18: number;
  close_e18: number;
  volume_usdc: number;
  trade_count: number;
}

export interface FundingRow {
  timestamp: string;
  funding_rate_e18: number;
  cumulative_funding: number;
  mark_price_e18: number;
  index_price_e18: number;
  interval_seconds: number;
}

export interface OiRow {
  bar_start: string;
  long_oi: number;
  short_oi: number;
}

const ALLOWED_LEADERBOARD_WINDOWS = ["24h", "7d", "30d", "all"] as const;
const ALLOWED_VOLUME_WINDOWS = ["24h", "7d"] as const;
const ALLOWED_BARS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const ALLOWED_OI_BARS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

function pickEnum<T extends readonly string[]>(
  raw: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (raw === undefined) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : fallback;
}

const analyticsRoutes = new Hono();

// GET /analytics/leaderboard?window=24h|7d|30d|all&limit=100&min_trades=5
analyticsRoutes.get("/leaderboard", async (c) => {
  try {
    const windowParam = pickEnum(c.req.query("window"), ALLOWED_LEADERBOARD_WINDOWS, "7d");
    const limit = clampLimit(c.req.query("limit"), 100, 100);
    const minTrades = clampLimit(c.req.query("min_trades"), 5, 1000);
    const envelope = await proxyPipe<LeaderboardRow>(PIPES.leaderboard, {
      window: windowParam,
      limit,
      min_trades: minTrades,
    });
    c.header("Cache-Control", READ_CACHE_HEADER);
    return c.json(envelope);
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /analytics/markets/:marketId/volume?window=24h|7d
analyticsRoutes.get("/markets/:marketId/volume", async (c) => {
  try {
    const marketId = c.req.param("marketId").toLowerCase();
    const windowParam = pickEnum(c.req.query("window"), ALLOWED_VOLUME_WINDOWS, "24h");
    const envelope = await proxyPipe<MarketVolumeRow>(PIPES.marketVolume, {
      market_id: marketId,
      window: windowParam,
    });
    c.header("Cache-Control", READ_CACHE_HEADER);
    return c.json(envelope);
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /analytics/markets/:marketId/ohlcv?bar=1m|5m|15m|1h|4h|1d&limit=500
analyticsRoutes.get("/markets/:marketId/ohlcv", async (c) => {
  try {
    const marketId = c.req.param("marketId").toLowerCase();
    const bar = pickEnum(c.req.query("bar"), ALLOWED_BARS, "1m");
    const limit = clampLimit(c.req.query("limit"), 500, 1000);
    const envelope = await proxyPipe<OhlcvRow>(PIPES.ohlcv, {
      market_id: marketId,
      bar,
      limit,
    });
    c.header("Cache-Control", READ_CACHE_HEADER);
    return c.json(envelope);
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /analytics/markets/:marketId/funding?limit=500
analyticsRoutes.get("/markets/:marketId/funding", async (c) => {
  try {
    const marketId = c.req.param("marketId").toLowerCase();
    const limit = clampLimit(c.req.query("limit"), 500, 1000);
    const envelope = await proxyPipe<FundingRow>(PIPES.funding, {
      market_id: marketId,
      limit,
    });
    c.header("Cache-Control", READ_CACHE_HEADER);
    return c.json(envelope);
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /analytics/markets/:marketId/oi?bar=5m&limit=500
analyticsRoutes.get("/markets/:marketId/oi", async (c) => {
  try {
    const marketId = c.req.param("marketId").toLowerCase();
    const bar = pickEnum(c.req.query("bar"), ALLOWED_OI_BARS, "5m");
    const limit = clampLimit(c.req.query("limit"), 500, 1000);
    const envelope = await proxyPipe<OiRow>(PIPES.oi, {
      market_id: marketId,
      bar,
      limit,
    });
    c.header("Cache-Control", READ_CACHE_HEADER);
    return c.json(envelope);
  } catch (e) {
    return jsonError(c, e);
  }
});

export { analyticsRoutes };
export type {
  AnalyticsEnvelope,
};
