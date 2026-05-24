import "server-only";

import type { MarketRegistryEntry } from "@bufi/shared-types";
import { bufiGet } from "./client";
import { MARKET_DATA_TAG } from "./markets";

type FxTelaranaMarketsResponse = { markets: MarketRegistryEntry[] };

export async function getFxTelaranaMarkets(chainId?: number): Promise<MarketRegistryEntry[]> {

  const { markets } = await bufiGet<FxTelaranaMarketsResponse>("/fx-telarana/markets", {
    chainId,
  });
  return markets;
}
