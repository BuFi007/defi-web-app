"use client";

/**
 * useMarginBalances — read the trader's margin numbers off
 * FxMarginAccount in a single multicall.
 *
 * The three view functions we care about for the margin-management UI:
 *   - `marginOf(trader)`         — total deposited (free + reserved)
 *   - `freeMarginOf(trader)`     — what the trader can withdraw or use
 *                                   to open new positions
 *   - `reservedMarginOf(trader)` — already backing open positions
 *
 * All three return uint256 in USDC base units (6 decimals on Arc/Fuji),
 * matching the `marginDecimals()` field on the contract. We batch them
 * through viem's `multicall` so a single RPC round-trip fetches the
 * whole snapshot — cheaper than three sequential `readContract` calls
 * and the values are guaranteed to come from the same block, so the
 * "free + reserved == total" invariant the UI displays never gets
 * caught straddling a state change.
 *
 * Refetch cadence (8s) is aligned with `usePositions()` so the margin
 * card and the positions list update together after a deposit /
 * withdraw / order-fill.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";

import { FxMarginAccountAbi, Perps } from "@bufi/contracts";

import { getPerpsReplacementDevWallet } from "./dev-mock-wallet";

const DEFAULT_CHAIN_ID = 5042002 as const;
const REFETCH_MS = 8_000;

export interface MarginBalances {
  /** Total deposited margin (free + reserved). USDC base units (bigint). */
  total: bigint;
  /** Margin available to withdraw or open new positions. USDC base units. */
  free: bigint;
  /** Margin already backing open positions. USDC base units. */
  reserved: bigint;
  /** USDC decimals on this chain (6 today on Arc/Fuji). */
  decimals: number;
}

const ZERO_BALANCES: MarginBalances = {
  total: 0n,
  free: 0n,
  reserved: 0n,
  decimals: 6,
};

/**
 * Resolves the trader address the same way `usePositions()` does:
 * explicit override → dev-mock wallet (E2E) → wagmi-connected account.
 * Kept structurally identical so the two hooks key off the same target.
 */
function resolveTarget(
  override: Address | undefined,
  wagmiAddress: Address | undefined,
): Address | undefined {
  if (override) return override;
  const devWallet = getPerpsReplacementDevWallet();
  if (devWallet?.address) return devWallet.address as Address;
  return wagmiAddress;
}

export function useMarginBalances(
  addressOverride?: Address,
  chainIdOverride?: number,
): UseQueryResult<MarginBalances> {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const publicClient = usePublicClient();

  const chainId =
    chainIdOverride ?? wagmiChainId ?? DEFAULT_CHAIN_ID;
  const target = useMemo(
    () => resolveTarget(addressOverride, address as Address | undefined),
    [addressOverride, address],
  );
  const marginAccount = useMemo(
    () => Perps.getPerpsContractAddress(chainId, "FxMarginAccount"),
    [chainId],
  );

  return useQuery<MarginBalances>({
    queryKey: [
      "perps",
      "margin-balances",
      chainId,
      target?.toLowerCase(),
    ],
    enabled: Boolean(target && marginAccount && publicClient),
    queryFn: async (): Promise<MarginBalances> => {
      if (!target || !marginAccount || !publicClient) return ZERO_BALANCES;
      // Multicall batches the four reads into one RPC round-trip. If
      // the chain doesn't have a multicall3 deployed viem falls back to
      // sequential reads automatically — still correct, just chattier.
      const [totalRaw, freeRaw, reservedRaw, decimalsRaw] =
        await publicClient.multicall({
          allowFailure: false,
          contracts: [
            {
              address: marginAccount,
              abi: FxMarginAccountAbi,
              functionName: "marginOf",
              args: [target],
            },
            {
              address: marginAccount,
              abi: FxMarginAccountAbi,
              functionName: "freeMarginOf",
              args: [target],
            },
            {
              address: marginAccount,
              abi: FxMarginAccountAbi,
              functionName: "reservedMarginOf",
              args: [target],
            },
            {
              address: marginAccount,
              abi: FxMarginAccountAbi,
              functionName: "marginDecimals",
              args: [],
            },
          ],
        });
      return {
        total: totalRaw as bigint,
        free: freeRaw as bigint,
        reserved: reservedRaw as bigint,
        decimals: Number(decimalsRaw as bigint | number),
      };
    },
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS / 2,
  });
}
