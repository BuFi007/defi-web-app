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
// 3s per inner RPC keeps the chained worst-case (listPools + id/live +
// market(state) = 3 awaits) under 10s -- comfortably below the API
// server's idleTimeout. The public Avalanche Fuji RPC has been the
// usual offender; when it's slow, each pool degrades to the static
// manifest fallback fast instead of leaving the socket hanging.
const DEFAULT_HUB_READ_TIMEOUT_MS = 3_000;

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

function hubReadTimeoutMs(): number {
  const configured = Number(
    process.env.FX_TELARANA_HUB_READ_TIMEOUT_MS ?? DEFAULT_HUB_READ_TIMEOUT_MS,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_HUB_READ_TIMEOUT_MS;
}

/**
 * Race a promise against a timeout. When a hub RPC hangs (the public
 * Avalanche Fuji RPC has done this in the past with no CORS, no body,
 * no error), the `Promise.all` in `listMarkets` would stall for the
 * full viem retry budget and the entire /fx-telarana/markets request
 * would never complete. Bound each hub's read so one slow chain falls
 * through to the static manifest instead of taking down the feed.
 */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const ms = hubReadTimeoutMs();
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`hub-read-timeout ${label} after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
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
 * isn't blank. State and `isLive` get conservative defaults. LLTV is read
 * per-market from the manifest's `marketLltvs` map (see `TelaranaMarket.lltv`
 * in @bufi/contracts) — no longer a hardcoded constant.
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
        lltv: market.lltv,
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
          const pools = await withTimeout(
            client.readContract({
              address: hub.marketRegistry,
              abi: FxMarketRegistryAbi,
              functionName: "listPools",
            }),
            `listPools ${hub.name}`,
          );

          return Promise.all(
            (pools as unknown[]).map(async (pool) => {
              const params = normalizeMarketParams(pool);
              const [id, isLive] = await withTimeout(
                Promise.all([
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
                ]),
                `marketIdOf/isPoolLive ${hub.name}`,
              );
              // Log silently-swallowed state-read failures so the UI
              // doesn't permanently show "—" for APY / TVL / Util when
              // an RPC hiccup or stale cache is the underlying cause.
              const state = await withTimeout(
                readMarketState({
                  client,
                  morpho: hub.morphoBlue,
                  marketId: id,
                }),
                `market-state ${hub.name}`,
              ).catch((err: unknown) => {
                console.warn(
                  `[fx-telarana] market state read failed`,
                  JSON.stringify({
                    hub: hub.name,
                    chainId: hub.chainId,
                    marketId: id,
                    morpho: hub.morphoBlue,
                    err: err instanceof Error ? err.message : String(err),
                  }),
                );
                return undefined;
              });

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
        } catch (listPoolsErr) {
          // listPools() reverts on the live FxMarketRegistry deployments
          // (both Arc + Fuji return "execution reverted" — confirmed via
          // direct cast call). Storage-layout drift between the deployed
          // bytecode and the current contract source is the likely cause;
          // owner() and marketIdOf() still work, only the iterating views
          // (listPools, isPoolLive) revert.
          //
          // Fall back to the static manifest BUT also fetch per-market
          // state directly from MorphoBlue — without this the UI shows
          // "—" for APY / supply / borrow / util / TVL on every row.
          console.warn(
            `[fx-telarana] listPools reverted on ${hub.name}; falling back to manifest + per-market state reads`,
            (listPoolsErr as Error)?.message ?? String(listPoolsErr),
          );
          const localStatic = staticMarkets().filter(
            (market) => market.hubChainId === hub.chainId,
          );
          return Promise.all(
            localStatic.map(async (m) => {
              const state = await withTimeout(
                readMarketState({
                  client,
                  morpho: hub.morphoBlue,
                  marketId: m.id,
                }),
                `static-state ${hub.name}`,
              ).catch((err: unknown) => {
                console.warn(
                  `[fx-telarana] static-state read failed`,
                  JSON.stringify({
                    hub: hub.name,
                    marketId: m.id,
                    err: err instanceof Error ? err.message : String(err),
                  }),
                );
                return undefined;
              });
              if (state) m.state = state;
              return m;
            }),
          );
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
