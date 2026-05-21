/**
 * Read-side queries against the analytics + market-data surface.
 *
 * These wrap the OHLCV + stats endpoints under `/perps/markets/:sym/*`.
 * For server-side analytics (Tinybird-backed), see the BUFI `/analytics/*`
 * routes — not yet wired into the SDK.
 */

import type { BufiClient } from "../client";

/** OHLCV candle. Prices are decimal strings; volume is USDC atomic 6dp. */
export interface OhlcvCandle {
  /** Bar open time, unix seconds. */
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

/** Options for {@link getOhlcv}. */
export interface GetOhlcvOptions {
  /** Candle interval. Accepts `"1m"`, `"5m"`, `"1h"`, `"1d"`, etc. */
  interval?: string;
  /** Max number of candles returned. API enforces an upper bound. */
  limit?: number;
  /** Inclusive lower bound, unix-seconds. */
  from?: number;
  /** Exclusive upper bound, unix-seconds. */
  to?: number;
  signal?: AbortSignal;
}

/**
 * Fetch OHLCV candles for a market symbol (e.g. `EURC_USDC`, `tJPYC_USDC`).
 */
export async function getOhlcv(
  client: BufiClient,
  symbol: string,
  opts: GetOhlcvOptions = {},
): Promise<{ symbol: string; candles: OhlcvCandle[] }> {
  return client.request<{ symbol: string; candles: OhlcvCandle[] }>({
    path: `/perps/markets/${encodeURIComponent(symbol)}/candles`,
    query: {
      interval: opts.interval,
      limit: opts.limit,
      from: opts.from,
      to: opts.to,
    },
    signal: opts.signal,
  });
}

/** Stats payload returned by `/perps/markets/:sym/stats`. */
export interface MarketStats {
  symbol: string;
  /** Decimal mark price. */
  markPrice: string;
  /** 24h price change in basis points. */
  change24hBps: number;
  /** 24h notional volume in USDC (decimal). */
  volume24h: string;
  /** Open interest in USDC notional (decimal). */
  openInterest: string;
  /** Most recent funding rate in BPS-per-hour. */
  fundingRateBpsPerHour: number;
  [extra: string]: unknown;
}

/**
 * Fetch market stats (24h volume, open interest, funding rate) for a symbol.
 */
export async function getMarketStats(
  client: BufiClient,
  symbol: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MarketStats> {
  return client.request<MarketStats>({
    path: `/perps/markets/${encodeURIComponent(symbol)}/stats`,
    signal: opts.signal,
  });
}

/** A single row in the matcher's pending-intents view. */
export interface PendingIntent {
  intentId: string;
  marketId: string;
  trader: string;
  side: "long" | "short";
  sizeUsdc: string;
  priceE18: string;
  postedAt: number;
}

/**
 * List the currently-pending intents the matcher is going to match. Useful
 * for orderbook depth visualizations.
 */
export async function getPendingIntents(
  client: BufiClient,
  opts: {
    marketId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ intents: PendingIntent[] }> {
  return client.request<{ intents: PendingIntent[] }>({
    path: "/perps/intents/pending",
    query: opts.marketId ? { marketId: opts.marketId } : undefined,
    signal: opts.signal,
  });
}
