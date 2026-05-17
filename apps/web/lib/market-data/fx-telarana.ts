import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { MarketRegistryEntry } from "@bufi/shared-types";
import { bufiGet } from "./client";
import { MARKET_DATA_TAG } from "./markets";

type FxTelaranaMarketsResponse = { markets: MarketRegistryEntry[] };

export async function getFxTelaranaMarkets(chainId?: number): Promise<MarketRegistryEntry[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(MARKET_DATA_TAG, `fx-telarana-markets-${chainId ?? "all"}`);

  const { markets } = await bufiGet<FxTelaranaMarketsResponse>("/fx-telarana/markets", {
    chainId,
  });
  return markets;
}
