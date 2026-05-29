// React Query hooks over the hyper-mcp protocol surface. Read-only; 30s refetch.
// One hook per family endpoint — components stay declarative + the precious
// existing UX is untouched (these are additive, used only by the /protocol page).
"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { mcpFetch } from "./client";

const REFETCH = 30_000;
function q<T>(key: unknown[], path: string, query?: Record<string, string | number | undefined>, enabled = true): UseQueryResult<T> {
  return useQuery({ queryKey: key, queryFn: () => mcpFetch<T>(path, query), refetchInterval: REFETCH, enabled, staleTime: 15_000 });
}

// ── oracle ──
export const useOraclePrice = (base: string, quote = "USDC") =>
  q<{ base: string; quote: string; mid?: string; stale?: boolean; ageSeconds?: number | null; error?: string }>(["oracle", "price", base, quote], "/api/oracle/price", { base, quote }, !!base);

// ── vault / LP (the LP-insurance centerpiece) ──
export const useVaultDepths = () =>
  q<{ vault: string; totalJuniorUsdc: string; seniorUsdcHot: string; juniorTokenBalances: Record<string, string> }>(["vault", "depths"], "/api/vault/depths");
export const useLpInfo = () =>
  q<{ vault: string; depositAsset: string; compositeApyPercent: string | null; totalDeposits: string; feeSplit: { protocolBps: number; lpBps: number; insuranceBps: number; note: string } }>(["lp", "info"], "/api/lp/info");
export const useLpPosition = (address?: string) =>
  q<{ address: string; pendingYield: string }>(["lp", "position", address], "/api/lp/position", { address }, !!address);

// ── hedge ──
export const useHedgePools = () =>
  q<{ hook: string; pools: { symbol: string; poolId: string; pair: string; fee: number }[] }>(["hedge", "pools"], "/api/hedge/pools");
export const useHedgeStatus = (poolId?: string) =>
  q<{ poolId: string; currentDelta?: string; isDeltaNeutral?: boolean; error?: string }>(["hedge", "status", poolId], "/api/hedge/status", { poolId }, !!poolId);

// ── fxswap ──
export const useFxswapPools = () =>
  q<{ router: string; pools: { asset: string; hook: string; pair: string; fee: number; pyth: string }[] }>(["fxswap", "pools"], "/api/fxswap/pools");
export const useFxswapQuote = (asset?: string, amountIn?: string, side: "buy" | "sell" = "buy") =>
  q<{ asset: string; side: string; amountOut?: string; spreadBps?: number | null; tradableOut?: string; error?: string }>(["fxswap", "quote", asset, amountIn, side], "/api/fxswap/quote", { asset, amountIn, side }, !!asset && !!amountIn);

// ── registry ──
export const useRegistryAssets = () =>
  q<{ count: number; assets: { symbol: string; decimals: number; enabled: boolean }[] }>(["registry", "assets"], "/api/registry/assets");

// ── perps / gateway ──
export const usePerpsAccount = (address?: string) =>
  q<{ trader: string; totalMargin: string; reservedMargin: string; freeMargin: string }>(["perps", "account", address], "/api/perps/account", { address }, !!address);
export const useGatewayInfo = () =>
  q<{ gatewayHook: string; gatewayBalance: string; withdrawalUnlockBlock: string }>(["gateway", "info"], "/api/gateway/info");
