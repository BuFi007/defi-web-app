/**
 * Read-side queries against the BUFI markets surface.
 *
 * All queries hit the public REST API and return JSON. For high-frequency
 * mark-price reads, use the WebSocket endpoint (`/ws/markets/:marketId`)
 * directly — the SDK does not yet wrap it.
 */

import type { ChainId } from "@bufi/shared-types";

import type { BufiClient } from "../client";

/**
 * Minimal shape returned by `GET /markets`. The full registry entry from
 * `@bufi/fx-telarana` has many more fields — we surface the integrator-
 * relevant subset.
 */
export interface BufiMarket {
  marketId: string;
  symbol: string;
  chainId: ChainId;
  baseAsset: string;
  quoteAsset: string;
  /** Whether the keeper is currently matching orders for this market. */
  enabled?: boolean;
  [extra: string]: unknown;
}

/** Options for {@link getMarkets}. */
export interface GetMarketsOptions {
  /**
   * Filter markets by chain. Defaults to `client.chainId` if set, otherwise
   * returns all markets across all chains.
   */
  chainId?: ChainId;
  signal?: AbortSignal;
}

/**
 * List all live perps + spot markets the BUFI API knows about.
 *
 * @example
 * ```ts
 * const { markets } = await getMarkets(bufi, { chainId: 5042002 });
 * ```
 */
export async function getMarkets(
  client: BufiClient,
  opts: GetMarketsOptions = {},
): Promise<{ markets: BufiMarket[] }> {
  const chainId = opts.chainId ?? client.chainId;
  return client.request<{ markets: BufiMarket[] }>({
    path: "/markets",
    query: chainId ? { chainId } : undefined,
    signal: opts.signal,
  });
}

/** Options for {@link getMarket}. */
export interface GetMarketOptions {
  signal?: AbortSignal;
}

/**
 * Fetch a single market by its bytes32 `marketId`.
 */
export async function getMarket(
  client: BufiClient,
  marketId: string,
  opts: GetMarketOptions = {},
): Promise<{ market: BufiMarket }> {
  return client.request<{ market: BufiMarket }>({
    path: `/markets/${encodeURIComponent(marketId)}`,
    signal: opts.signal,
  });
}

/** Response shape from `/markets/:marketId/price`. */
export interface MarkPriceSnapshot {
  marketId: string;
  /** Decimal mark price as a string (e.g. `"1.0823"`). */
  price: string;
  /** Unix-seconds timestamp the oracle attested to this price. */
  publishTime: number;
  /** Whether the oracle is older than `maxStaleSeconds`. */
  isStale: boolean;
  ageSeconds: number;
  maxStaleSeconds: number;
}

/**
 * Fetch the most-recent mark price for a market. For live streaming, use
 * the `/ws/markets/:marketId` WebSocket directly.
 */
export async function getMarkPrice(
  client: BufiClient,
  marketId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MarkPriceSnapshot> {
  return client.request<MarkPriceSnapshot>({
    path: `/markets/${encodeURIComponent(marketId)}/price`,
    signal: opts.signal,
  });
}
