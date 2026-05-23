/**
 * Privacy Hook UI bindings.
 *
 * Reads the shielded-pool surface (latest merkle root, configured swap
 * adapter, per-asset pool addresses) from the `/privacy/*` API routes.
 * React Query handles caching + a 30s refetch interval — the on-chain
 * root only advances on deposits/relays so anything tighter would burn
 * RPC budget for no UX gain.
 *
 * Pair this with `useGhostMode()` from `@/context/GhostModeContext`:
 * `useGhostMode().isGhostMode` is the user's intent (toggle), this
 * hook surfaces what's actually deployed for them to use. Future work:
 * route real trades through the `@bufi/fx-telarana-sdk` PrivacyTradeClient
 * when isGhostMode is true.
 */

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Address, Hex } from "viem";

import { bufxApiUrl } from "@/lib/perps/replacement-agent";

export type PrivacyChainKey = "arc" | "fuji";

export interface PrivacyAssetDto {
  symbol: "USDC" | "EURC";
  token: Address;
  pool: Address;
}

export interface PrivacyAssetsDto {
  chain: PrivacyChainKey;
  chainId: number;
  assets: PrivacyAssetDto[];
  crossCurrencyEnabled: boolean;
}

export interface PrivacyStateDto {
  chain: PrivacyChainKey;
  chainId: number;
  addresses: {
    entrypoint?: Address;
    entrypointImpl?: Address;
    swapAdapter?: Address;
    poolUSDC?: Address;
    poolEURC?: Address;
    commitmentVerifier?: Address;
    withdrawalVerifier?: Address;
    poseidonT3?: Address;
    poseidonT4?: Address;
  };
  live: {
    /** Stringified bigint (`jsonSafe` serialisation). */
    latestRoot: string | { error: string };
    configuredSwapAdapter: Address | null | { error: string };
  };
}

const REFRESH_MS = 30_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function usePrivacyAssets(
  chain: PrivacyChainKey = "arc",
): UseQueryResult<PrivacyAssetsDto> {
  return useQuery({
    queryKey: ["privacy", "assets", chain],
    queryFn: () => fetchJson<PrivacyAssetsDto>(bufxApiUrl(`/privacy/assets?chain=${chain}`)),
    staleTime: 5 * 60_000,
  });
}

export function usePrivacyState(
  chain: PrivacyChainKey = "arc",
): UseQueryResult<PrivacyStateDto> {
  return useQuery({
    queryKey: ["privacy", "state", chain],
    queryFn: () => fetchJson<PrivacyStateDto>(bufxApiUrl(`/privacy/state?chain=${chain}`)),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });
}

/** Convenience: resolve a scope id (uint256 as decimal or 0x-hex) to its pool address. */
export function buildPrivacyPoolUrl(chain: PrivacyChainKey, scope: bigint | string | Hex): string {
  const value = typeof scope === "bigint" ? scope.toString() : String(scope);
  return bufxApiUrl(`/privacy/pool?chain=${chain}&scope=${encodeURIComponent(value)}`);
}
