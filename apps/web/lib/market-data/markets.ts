import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { MarketRegistryEntry } from "@bufi/shared-types";
import { api } from "@/lib/api-client";
import { bufiGet } from "./client";

export const MARKET_DATA_TAG = "market-data" as const;

type MarketsResponse = { markets: MarketRegistryEntry[] };
type MarketResponse = { market: MarketRegistryEntry };
export type MarketPrice = {
  marketId: string;
  source: "pyth";
  price: string | null;
  confidence: string | null;
  ts: number | null;
  oracleStaleSeconds: number | null;
  updateData: `0x${string}`[];
};

/**
 * All live Telarana markets, optionally filtered by chain.
 * Markets change rarely (new chain deployments) — minutes is plenty.
 * Tag with both the global market-data tag and a per-chain tag so the
 * keeper / indexer can invalidate at the right granularity.
 */
export async function getMarkets(chainId?: number): Promise<MarketRegistryEntry[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(MARKET_DATA_TAG, `markets-list${chainId ? `-${chainId}` : ""}`);

  const { markets } = await bufiGet<MarketsResponse>("/markets", { chainId });
  return markets;
}

export async function getMarket(marketId: string): Promise<MarketRegistryEntry | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(MARKET_DATA_TAG, `market-${marketId}`);

  // wk1d2: routed through the typed BFF client (hc<AppType>). Response
  // shape `{ market: MarketRegistryEntry }` is inferred from
  // apps/api/src/routes/markets.ts. Behavior preserved: 404/other-error
  // still maps to `null` so RSC fallback paths keep rendering.
  try {
    const res = await api.markets[":marketId"].$get({ param: { marketId } });
    if (!res.ok) return null;
    const { market } = await res.json();
    // The zod schema is `.passthrough()` on MarketRegistryEntry — runtime
    // shape matches the shared type, narrow with a cast at the boundary.
    return market as MarketRegistryEntry;
  } catch {
    return null;
  }
}

/**
 * Pyth-sourced price for a market. Oracle publishes ~every 400ms; the
 * upstream API also already fetches fresh. We cache for ~15s so back-to-back
 * RSC renders share a single hop, but keep the value visibly fresh.
 */
export async function getMarketPrice(marketId: string): Promise<MarketPrice> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  cacheTag(MARKET_DATA_TAG, `market-price-${marketId}`);

  return bufiGet<MarketPrice>(`/markets/${marketId}/price`);
}
