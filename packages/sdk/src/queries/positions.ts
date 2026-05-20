/**
 * Read-side queries against the perps positions + trades endpoints.
 */

import type { Address, Hex } from "viem";

import type { BufiClient } from "../client";

/**
 * A single open perps position as returned by `/perps/positions/:address`.
 *
 * The on-chain source of truth is `FxMarginAccount.positions(trader, marketId)`
 * + `FxFundingEngine` for the cumulative funding component; the API merges
 * both into a single object.
 */
export interface PerpsPosition {
  marketId: Hex;
  symbol?: string;
  trader: Address;
  /**
   * Signed size in `1e18` units. Positive = long, negative = short.
   * Stringified to avoid `bigint` JSON roundtrip issues.
   */
  sizeDeltaE18: string;
  /** Margin currently locked against this position, in USDC atomic (6dp). */
  margin: string;
  /** Average entry price, decimal string. */
  entryPrice: string;
  /** Cumulative funding paid (positive = paid, negative = received). */
  cumulativeFunding: string;
  /** Most recent unrealized PnL snapshot from the API. */
  unrealizedPnl?: string;
  /** Liquidation price if the oracle moves against the trader. */
  liquidationPrice?: string;
  [extra: string]: unknown;
}

/** A historical fill from `/perps/trades/:address`. */
export interface PerpsTrade {
  intentId: string;
  marketId: Hex;
  symbol?: string;
  side: "long" | "short";
  sizeUsdc: string;
  /** Fill price as a decimal string. */
  price: string;
  fee: string;
  txHash: Hex;
  /** Unix-seconds timestamp the fill landed on-chain. */
  filledAt: number;
  [extra: string]: unknown;
}

/** Options for {@link getPositions}. */
export interface GetPositionsOptions {
  signal?: AbortSignal;
}

/**
 * List open perps positions for a given trader address.
 *
 * @example
 * ```ts
 * const { positions } = await getPositions(bufi, "0xabc…", {});
 * ```
 */
export async function getPositions(
  client: BufiClient,
  trader: Address,
  opts: GetPositionsOptions = {},
): Promise<{ positions: PerpsPosition[] }> {
  return client.request<{ positions: PerpsPosition[] }>({
    path: `/perps/positions/${encodeURIComponent(trader)}`,
    signal: opts.signal,
  });
}

/**
 * List recent perps trades (fills) for a trader.
 */
export async function getTrades(
  client: BufiClient,
  trader: Address,
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<{ trades: PerpsTrade[] }> {
  return client.request<{ trades: PerpsTrade[] }>({
    path: `/perps/trades/${encodeURIComponent(trader)}`,
    query: opts.limit !== undefined ? { limit: opts.limit } : undefined,
    signal: opts.signal,
  });
}
