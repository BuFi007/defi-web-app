import type { Address, Hex, PublicClient } from "viem";

import { FxMarketRegistryAbi } from "@bufi/contracts";
import {
  TELARANA_MARKETS,
  TELARANA_DEPLOYMENTS,
  type TelaranaHubChainId,
} from "@bufi/contracts/telarana";

import { LENDING_HUBS } from "./chains";
import { getHubClient, type HubClientMap } from "./clients";
import { MorphoBlueAbi } from "./morpho-blue-abi";
import type { LendingMarket, MarketParams, MorphoMarketState } from "./types";

const DEFAULT_MARKET_CACHE_MS = 30_000;

type MarketListCache = {
  expiresAt: number;
  markets: LendingMarket[];
};

let marketListCache: MarketListCache | null = null;
let marketListInFlight: Promise<LendingMarket[]> | null = null;

function marketCacheTtlMs(): number {
  const configured = Number(process.env.FX_TELARANA_MARKET_CACHE_MS ?? DEFAULT_MARKET_CACHE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

function normalizeMarketParams(value: unknown): MarketParams {
  const record = value as {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
  };
  return {
    loanToken: record.loanToken,
    collateralToken: record.collateralToken,
    oracle: record.oracle,
    irm: record.irm,
    lltv: BigInt(record.lltv),
  };
}

export async function readMarketState(args: {
  client: PublicClient;
  morpho: Address;
  marketId: Hex;
}): Promise<MorphoMarketState> {
  const tuple = (await args.client.readContract({
    address: args.morpho,
    abi: MorphoBlueAbi,
    functionName: "market",
    args: [args.marketId],
  })) as MorphoMarketState;
  return {
    totalSupplyAssets: BigInt(tuple.totalSupplyAssets),
    totalSupplyShares: BigInt(tuple.totalSupplyShares),
    totalBorrowAssets: BigInt(tuple.totalBorrowAssets),
    totalBorrowShares: BigInt(tuple.totalBorrowShares),
    lastUpdate: BigInt(tuple.lastUpdate),
    fee: BigInt(tuple.fee),
  };
}

export function clearMarketListCacheForTests(): void {
  marketListCache = null;
  marketListInFlight = null;
}

/**
 * Fall-back: if the on-chain registry read fails (e.g. RPC offline during dev),
 * we still surface the markets declared in the deployment manifests so the UI
 * isn't blank. State and `isLive` get conservative defaults.
 */
function staticMarkets(): LendingMarket[] {
  return (Object.entries(TELARANA_DEPLOYMENTS) as Array<[string, (typeof TELARANA_DEPLOYMENTS)[TelaranaHubChainId]]>).flatMap(
    ([chainIdStr, deployment]) => {
      const chainId = Number(chainIdStr) as TelaranaHubChainId;
      return deployment.markets.map((market): LendingMarket => ({
        id: market.id,
        hubChainId: chainId,
        hubName: deployment.hubName,
        isLive: true,
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.morphoOracleAdapter,
        irm: deployment.contracts.IrmMock,
        // LLTV from the protocol manifest: M1 + M2 both ship at 86% (0.86e18).
        lltv: 860_000_000_000_000_000n,
      }));
    },
  );
}

export async function listMarkets(
  options: { clients?: HubClientMap; forceRefresh?: boolean } = {},
): Promise<LendingMarket[]> {
  const cacheTtlMs = marketCacheTtlMs();
  const canUseCache = !options.clients && !options.forceRefresh && cacheTtlMs > 0;
  if (canUseCache && marketListCache && marketListCache.expiresAt > Date.now()) {
    return marketListCache.markets;
  }

  if (canUseCache && marketListInFlight) {
    return marketListInFlight;
  }

  const readMarkets = async () => {
    const perHub = await Promise.all(
      LENDING_HUBS.map(async (hub) => {
        const client = getHubClient(options.clients, hub.chainId);
        try {
          const pools = await client.readContract({
            address: hub.marketRegistry,
            abi: FxMarketRegistryAbi,
            functionName: "listPools",
          });

          return Promise.all(
            (pools as unknown[]).map(async (pool) => {
              const params = normalizeMarketParams(pool);
              const [id, isLive] = await Promise.all([
                client.readContract({
                  address: hub.marketRegistry,
                  abi: FxMarketRegistryAbi,
                  functionName: "marketIdOf",
                  args: [params.loanToken, params.collateralToken],
                }) as Promise<Hex>,
                client.readContract({
                  address: hub.marketRegistry,
                  abi: FxMarketRegistryAbi,
                  functionName: "isPoolLive",
                  args: [params.loanToken, params.collateralToken],
                }) as Promise<boolean>,
              ]);
              const state = await readMarketState({
                client,
                morpho: hub.morphoBlue,
                marketId: id,
              }).catch(() => undefined);

              const market: LendingMarket = {
                ...params,
                id,
                hubChainId: hub.chainId,
                hubName: hub.name,
                isLive,
              };

              if (state) {
                market.state = state;
              }
              return market;
            }),
          );
        } catch {
          // Hub unreachable; fall back to the static manifest for this hub so
          // the rest of the system can still progress.
          return staticMarkets().filter((market) => market.hubChainId === hub.chainId);
        }
      }),
    );

    const markets = perHub.flat();
    if (canUseCache) {
      marketListCache = {
        markets,
        expiresAt: Date.now() + cacheTtlMs,
      };
    }
    return markets;
  };

  if (!canUseCache) {
    return readMarkets();
  }

  marketListInFlight = readMarkets().finally(() => {
    marketListInFlight = null;
  });
  return marketListInFlight;
}

export async function getMarketById(args: {
  hubChainId: TelaranaHubChainId;
  marketId: Hex;
  clients?: HubClientMap;
}): Promise<LendingMarket | null> {
  const markets = await listMarkets(args.clients ? { clients: args.clients } : {});
  return (
    markets.find(
      (market) =>
        market.hubChainId === args.hubChainId &&
        market.id.toLowerCase() === args.marketId.toLowerCase(),
    ) ?? null
  );
}

export async function getMarketByPair(args: {
  hubChainId: TelaranaHubChainId;
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  clients?: HubClientMap;
}): Promise<LendingMarket | null> {
  const markets = await listMarkets(args.clients ? { clients: args.clients } : {});
  return (
    markets.find(
      (market) =>
        market.hubChainId === args.hubChainId &&
        market.loanToken.toLowerCase() === args.loanToken.toLowerCase() &&
        market.collateralToken.toLowerCase() === args.collateralToken.toLowerCase(),
    ) ?? null
  );
}

export function getDeclaredMarkets(): LendingMarket[] {
  return staticMarkets();
}

export { TELARANA_MARKETS };
