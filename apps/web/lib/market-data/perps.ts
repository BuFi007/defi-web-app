import "server-only";

import type { MarketRegistryEntry } from "@bufi/shared-types";
import { bufiGet } from "./client";
import { MARKET_DATA_TAG } from "./markets";

type PerpsMarketsResponse = { markets: MarketRegistryEntry[] };
type PerpsFundingResponse = { funding: unknown };

export async function getPerpsMarkets(chainId?: number): Promise<MarketRegistryEntry[]> {

  const { markets } = await bufiGet<PerpsMarketsResponse>("/perps/markets", { chainId });
  return markets;
}

/**
 * Funding rates per chain (+ optional market). Funding rotates on a slow
 * cadence — minutes is fine; let the keeper bust the tag on each new epoch.
 */
export async function getPerpsFunding(opts: {
  chainId?: number;
  marketId?: string;
}): Promise<PerpsFundingResponse["funding"]> {
  const key = `perps-funding-${opts.chainId ?? "all"}${opts.marketId ? `-${opts.marketId}` : ""}`;

  const { funding } = await bufiGet<PerpsFundingResponse>("/perps/funding", {
    chainId: opts.chainId,
    marketId: opts.marketId,
  });
  return funding;
}
