"use client";

/**
 * Thin convenience wrapper around `useOrderbookStream` that exposes only
 * the trade-tape slice. Components like the trade-tape sidebar don't care
 * about the book or funding-rate state and shouldn't re-render when those
 * slices update.
 *
 * Under the hood this is the same WS connection — `useOrderbookStream`
 * subscribes to all channels for a market, and we just return one slice.
 * For a single-purpose UI (trade tape only, no book) the unused slices
 * are inert: their setters fire, but the destructured caller never reads
 * them, so React reconciles the wrapper's output without touching the
 * component tree below.
 */

import { useMemo } from "react";

import {
  useOrderbookStream,
  type TradeMessage,
  type UseOrderbookStreamOptions,
} from "./use-orderbook-stream";

export interface UseTradeStreamResult {
  trades: TradeMessage[];
  isConnected: boolean;
  lastUpdate: number;
}

export function useTradeStream(
  marketId: string,
  options: UseOrderbookStreamOptions = {},
): UseTradeStreamResult {
  const { trades, isConnected, lastUpdate } = useOrderbookStream(
    marketId,
    options,
  );
  return useMemo(
    () => ({ trades, isConnected, lastUpdate }),
    [trades, isConnected, lastUpdate],
  );
}

export type { TradeMessage } from "./use-orderbook-stream";
