import { ARC_PERP_MARKETS, loadContracts } from "@bufi/contracts";
import type { ChainId, MarketRegistryEntry } from "@bufi/shared-types";

const ARC_CHAIN_ID = 5042002 satisfies ChainId;

export function livePerpsMarkets(chainId?: number): MarketRegistryEntry[] {
  const contracts = loadContracts();
  return Object.entries(ARC_PERP_MARKETS).flatMap(([symbol, market]) => {
    if (chainId !== undefined && market.chainId !== chainId) return [];
    const chain = contracts[market.chainId];
    const baseAsset = chain.tokens[market.baseToken];
    const quoteAsset = chain.tokens[market.quoteToken];
    if (!baseAsset || !quoteAsset) return [];
    return [
      {
        marketId: market.marketId,
        symbol,
        baseAsset,
        quoteAsset,
        source: "pyth",
        chainId: market.chainId,
        enabled: market.config.enabled && market.fundingConfig.enabled,
      } satisfies MarketRegistryEntry,
    ];
  });
}

export function livePerpsMarketIds(chainId: ChainId = ARC_CHAIN_ID): string[] {
  const configured = Object.keys(loadContracts()[chainId]?.perps.markets ?? {});
  const protocol = livePerpsMarkets(chainId)
    .filter((market) => market.enabled)
    .map((market) => market.marketId);
  return [...new Set([...configured, ...protocol])];
}
