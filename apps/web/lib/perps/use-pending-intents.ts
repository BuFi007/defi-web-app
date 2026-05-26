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

function recumulateLevels(levels: PendingLevel[]): PendingLevel[] {
  let running = 0;
  return levels.map((l) => {
    running += l.size;
    return { ...l, total: running };
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
      const rawBids = decodeLevels(raw.bids);
      const rawAsks = decodeLevels(raw.asks);

      // Filter out far-OTM canary/test levels (e.g. 10,000 on a 1.16
      // FX pair). Use the tightest realistic level from each side to
      // derive a reference price, then discard anything >5x away.
      const refBid = rawBids.find((l) => l.price < 50_000) ?? rawBids[0];
      const refAsk = rawAsks.find((l) => l.price < 50_000) ?? rawAsks[0];
      const ref = refBid && refAsk
        ? (refBid.price + refAsk.price) / 2
        : refBid?.price ?? refAsk?.price ?? 0;
      const lo = ref * 0.2;
      const hi = ref * 5;
      const inRange = (l: PendingLevel) => ref === 0 || (l.price >= lo && l.price <= hi);
      const bids = recumulateLevels(rawBids.filter(inRange));
      const asks = recumulateLevels(rawAsks.filter(inRange));

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
