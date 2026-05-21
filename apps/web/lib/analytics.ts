/**
 * Browser-side client for the /analytics/* read endpoints served by
 * `apps/api`. Pattern mirrors lib/bento/client.ts + lib/perps/client.ts:
 *
 *   - Single env var (NEXT_PUBLIC_API_URL) drives the base URL.
 *   - `resilientFetch` for retry / backoff / 5xx handling.
 *   - Typed envelopes match the Hono route exports so the wire shape
 *     stays in sync.
 *
 * Wire types (LeaderboardRow / MarketVolumeRow / etc.) are duplicated
 * here on purpose. The repo doesn't have a typed RPC client (no
 * `hc<AppType>`) wired up across apps/api → apps/web, so we re-declare
 * the row shapes that the analytics route emits and rely on the
 * `apps/api/typecheck` + `apps/web/typecheck` running in lockstep to
 * catch drift. When the typed-RPC handoff lands, replace these locals
 * with imports from `@bufi/api/routes/analytics`.
 */

import { resilientFetch } from "@/lib/api-client";

const DEFAULT_API_URL = "http://localhost:3002";

export function analyticsApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL ??
    DEFAULT_API_URL
  );
}

function analyticsUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`/analytics${path}`, analyticsApiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// ---------- Wire types (kept in sync with apps/api/src/routes/analytics.ts) ----------

export interface AnalyticsEnvelope<TRow> {
  data: TRow[];
  analyticsAvailable: boolean;
  reason?: string;
  cachedAt: number;
  source: "tinybird" | "disabled";
  pipe: string | null;
}

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

export type LeaderboardWindow = "24h" | "7d" | "30d" | "all";
export type VolumeWindow = "24h" | "7d";
export type OhlcvBar = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type OiBar = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

// ---------- Query helpers ----------

async function fetchEnvelope<TRow>(
  url: string,
  signal?: AbortSignal,
): Promise<AnalyticsEnvelope<TRow>> {
  const res = await resilientFetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    // Surface the structured envelope shape even when the route
    // itself errored — callers always get something to render.
    return {
      data: [],
      analyticsAvailable: false,
      reason: `HTTP ${res.status}`,
      cachedAt: Date.now(),
      source: "disabled",
      pipe: null,
    };
  }
  return (await res.json()) as AnalyticsEnvelope<TRow>;
}

export function fetchLeaderboard(args: {
  window?: LeaderboardWindow;
  limit?: number;
  minTrades?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsEnvelope<LeaderboardRow>> {
  return fetchEnvelope<LeaderboardRow>(
    analyticsUrl("/leaderboard", {
      window: args.window,
      limit: args.limit,
      min_trades: args.minTrades,
    }),
    args.signal,
  );
}

export function fetchMarketVolume(args: {
  marketId: string;
  window?: VolumeWindow;
  signal?: AbortSignal;
}): Promise<AnalyticsEnvelope<MarketVolumeRow>> {
  return fetchEnvelope<MarketVolumeRow>(
    analyticsUrl(`/markets/${encodeURIComponent(args.marketId.toLowerCase())}/volume`, {
      window: args.window,
    }),
    args.signal,
  );
}

export function fetchOhlcv(args: {
  marketId: string;
  bar?: OhlcvBar;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsEnvelope<OhlcvRow>> {
  return fetchEnvelope<OhlcvRow>(
    analyticsUrl(`/markets/${encodeURIComponent(args.marketId.toLowerCase())}/ohlcv`, {
      bar: args.bar,
      limit: args.limit,
    }),
    args.signal,
  );
}

export function fetchFundingHistory(args: {
  marketId: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsEnvelope<FundingRow>> {
  return fetchEnvelope<FundingRow>(
    analyticsUrl(`/markets/${encodeURIComponent(args.marketId.toLowerCase())}/funding`, {
      limit: args.limit,
    }),
    args.signal,
  );
}

export function fetchOiHistory(args: {
  marketId: string;
  bar?: OiBar;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsEnvelope<OiRow>> {
  return fetchEnvelope<OiRow>(
    analyticsUrl(`/markets/${encodeURIComponent(args.marketId.toLowerCase())}/oi`, {
      bar: args.bar,
      limit: args.limit,
    }),
    args.signal,
  );
}
