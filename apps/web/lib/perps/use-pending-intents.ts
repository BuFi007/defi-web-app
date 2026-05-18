"use client";

/**
 * Wraps /perps/intents/pending into a hook + lossy-float view model for
 * the order-book replacement.
 *
 * This is NOT a CLOB order book — the system is a price-time matcher
 * (`apps/keeper-perps-matcher`) so what we render here is pending
 * signed intents grouped by price level. Bids = pending longs, asks =
 * pending shorts. The card title is updated to "Pending Intents" to
 * stay honest about what the user is seeing.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { bufxApiUrl } from "@/lib/perps/replacement-agent";
import { e18ToNumber, safeBigInt } from "@/lib/perps/units";

const POLL_MS = 5_000;

export interface PendingIntentLevelRaw {
  priceE18: string;
  sizeE18: string;
  count: number;
}

export interface PendingIntentsRaw {
  marketId: string;
  depth: number;
  bids: PendingIntentLevelRaw[];
  asks: PendingIntentLevelRaw[];
  totalPending: number;
}

export interface PendingLevel {
  price: number;
  size: number;
  total: number;
  count: number;
}

export interface PendingIntentsView {
  bids: PendingLevel[];
  asks: PendingLevel[];
  totalPending: number;
  maxTotal: number;
  /** Convenience mid — average of best bid + best ask. Null when one side
   *  is empty. */
  mid: number | null;
}

function decodeLevels(levels: PendingIntentLevelRaw[]): PendingLevel[] {
  let running = 0;
  return levels.map((l) => {
    const price = e18ToNumber(safeBigInt(l.priceE18)) ?? 0;
    const size = e18ToNumber(safeBigInt(l.sizeE18)) ?? 0;
    running += size;
    return { price, size, total: running, count: l.count };
  });
}

export function usePendingIntents(
  marketId: string | undefined,
  depth = 10,
): UseQueryResult<PendingIntentsView> {
  return useQuery({
    queryKey: ["perps", "intents", "pending", marketId, depth],
    enabled: Boolean(marketId),
    queryFn: async ({ signal }): Promise<PendingIntentsView> => {
      const url = bufxApiUrl(`/perps/intents/pending`, { marketId, depth });
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`pending-intents ${res.status}`);
      const raw = (await res.json()) as PendingIntentsRaw;
      const bids = decodeLevels(raw.bids);
      const asks = decodeLevels(raw.asks);
      const maxTotal = Math.max(
        bids.length ? bids[bids.length - 1].total : 0,
        asks.length ? asks[asks.length - 1].total : 0,
        1,
      );
      const mid =
        bids.length && asks.length ? (bids[0].price + asks[0].price) / 2 : null;
      return { bids, asks, totalPending: raw.totalPending, maxTotal, mid };
    },
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
  });
}
