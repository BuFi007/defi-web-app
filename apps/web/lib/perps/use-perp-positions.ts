/**
 * Cross-chain perp position aggregator.
 *
 * The on-chain getter `FxPerpClearinghouse.position(marketId, trader)`
 * returns the trader's position struct for one (chain, market) pair —
 * so a complete cross-chain view requires N markets × M chains reads.
 * We funnel every read on a chain through a single
 * `useReadContracts` so wagmi batches the N reads via multicall3
 * (canonical address baked into viem's Arc + Fuji chain definitions —
 * same trick `apps/web/components/stablecoin-balances/index.tsx` uses
 * to collapse 40 balance reads down to 4 multicalls).
 *
 * Why on-chain instead of `/perps/positions/:address`:
 *   - The API endpoint is single-chain (scoped to wagmi's current
 *     chain id). Cross-chain aggregation would need either a
 *     fan-out per chain on the server OR a per-chain client call
 *     anyway — and at that point the on-chain read is more honest
 *     because it bypasses any indexer lag.
 *   - The matcher writes to the clearinghouse on every fill, so the
 *     contract is the source of truth.
 *
 * The hook returns ONE row per (chain, market) that has a non-zero
 * `sizeE18`. Empty markets are filtered out. Each row carries the
 * chain id + market key so the table can render a chain badge inline
 * and let the user pivot the selector on click.
 *
 * Live OI / mark / liq price are NOT in the position struct — those
 * are derived elsewhere (mark from `useLiveMarket`, liq from
 * `@bufi/perps-math.liquidationPriceFloat`). We expose the raw
 * `entryPriceE18`, `sizeE18`, and `marginReserved` so the caller can
 * thread them through whatever pricing source it already uses.
 *
 * Cache key: `["perps", "cross-chain-positions", trader]`. We DON'T
 * key on chainId because this is the cross-chain view by definition.
 */

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address, Hex } from "viem";

import { FxPerpClearinghouseAbi } from "@bufi/contracts";
import {
  ARC_PERP_MARKETS,
  type ArcPerpMarketSymbol,
} from "@bufi/contracts";

import {
  PERPS_CHAINS,
  type PerpsChainId,
  type FxPerpMarketKey,
} from "./chains";

export interface CrossChainPositionRow {
  /** Hub chain id (43113 = Fuji, 5042002 = Arc). */
  chainId: PerpsChainId;
  /** UI market key (e.g. "EURC_USDC"). */
  marketKey: FxPerpMarketKey;
  /** Bytes32 market id resolved from the hub registry. */
  marketId: Hex;
  /** Signed contract size, 1e18 base. Positive = long, negative = short. */
  sizeE18: bigint;
  /** Volume-weighted average entry price, 1e18. */
  entryPriceE18: bigint;
  /** Margin reserved to back this position. USDC 1e6 units (per contract spec). */
  marginReserved: bigint;
  /** Last funding version touched. Used by the indexer to compute funding-attribution. */
  lastFundingVersion: bigint;
  /** Convenience signed-side derived from `sizeE18`. */
  side: "long" | "short";
  /** Absolute notional in USDC (decimal float). `null` if mark price unavailable. */
  notionalUsdc: number | null;
}

/**
 * Resolve a per-chain `(marketKey → bytes32 marketId)` map. Only Arc has
 * its market ids enumerated in @bufi/contracts today (`ARC_PERP_MARKETS`);
 * Fuji's broadcast is pending so we return null entries until the
 * deploy lands and the manifest is patched.
 */
function marketIdMap(chainId: PerpsChainId): Partial<Record<FxPerpMarketKey, Hex>> {
  if (chainId === 5042002) {
    // ARC_PERP_MARKETS keys by display symbol ("EURC/USDC"); translate
    // to the FxPerpMarketKey ("EURC_USDC") used by the chain-selector
    // and the registry sync from PR #28.
    const map: Partial<Record<FxPerpMarketKey, Hex>> = {};
    const display: Record<ArcPerpMarketSymbol, FxPerpMarketKey> = {
      "EURC/USDC": "EURC_USDC",
      "tJPYC/USDC": "TJPYC_USDC",
      "tMXNB/USDC": "TMXNB_USDC",
      "tCHFC/USDC": "TCHFC_USDC",
    };
    for (const [sym, market] of Object.entries(ARC_PERP_MARKETS) as Array<
      [ArcPerpMarketSymbol, (typeof ARC_PERP_MARKETS)[ArcPerpMarketSymbol]]
    >) {
      const key = display[sym];
      if (key) map[key] = market.marketId;
    }
    return map;
  }
  // Fuji: market ids land here once fx-telarana PR #28 broadcasts.
  return {};
}

interface UseCrossChainPositionsOptions {
  /** Wallet address. Hook is disabled when missing. */
  trader: Address | undefined;
  /** Optional per-chain marketKey → markPriceE18 map for notional sizing. */
  markPriceE18?: Partial<Record<PerpsChainId, Partial<Record<FxPerpMarketKey, bigint>>>>;
}

export interface UseCrossChainPositionsResult {
  rows: CrossChainPositionRow[];
  isLoading: boolean;
  isError: boolean;
  /** Per-chain disabled / pending state, useful for the empty-table message. */
  chains: typeof PERPS_CHAINS;
}

/**
 * Fan out `position(marketId, trader)` across every (live perp chain ×
 * enumerable market) and collapse the result into the position-list
 * row shape.
 *
 * Hook count: one `useReadContracts` per PERPS_CHAINS entry (currently
 * 2 = Arc + Fuji). Stable across renders.
 */
export function useCrossChainPositions(
  options: UseCrossChainPositionsOptions,
): UseCrossChainPositionsResult {
  const trader = options.trader;

  // Precompute the contracts[] array per chain, keeping the per-slot
  // metadata so we can map the result back to (chainId, marketKey).
  const perChain = PERPS_CHAINS.map((chain) => {
    type Slot = { marketKey: FxPerpMarketKey; marketId: Hex };
    const idMap = marketIdMap(chain.chainId);
    const slots: Slot[] = [];
    for (const key of chain.marketKeys) {
      const id = idMap[key];
      if (id) slots.push({ marketKey: key, marketId: id });
    }
    return { chain, slots };
  });

  const queries = perChain.map(({ chain, slots }) => {
    const traderArg: Address = trader ?? "0x0000000000000000000000000000000000000000";
    const clearinghouse = chain.clearinghouseAddress;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useReadContracts({
      contracts: slots.map((s) => ({
        address: clearinghouse as Address,
        abi: FxPerpClearinghouseAbi,
        functionName: "position" as const,
        args: [s.marketId, traderArg] as const,
        chainId: chain.chainId,
      })),
      allowFailure: true,
      query: {
        enabled: Boolean(
          trader && chain.enabled && clearinghouse && slots.length > 0,
        ),
        // Positions update on every fill — match the API hook's cadence
        // so the two views feel like one when shown side by side.
        refetchInterval: 8_000,
        staleTime: 4_000,
      },
    });
  });

  return useMemo<UseCrossChainPositionsResult>(() => {
    const rows: CrossChainPositionRow[] = [];
    let isLoading = false;
    let chainsWithError = 0;
    let queriesAttempted = 0;

    for (let i = 0; i < perChain.length; i++) {
      const { chain, slots } = perChain[i]!;
      const query = queries[i]!;
      if (!chain.enabled || slots.length === 0 || !trader) continue;
      queriesAttempted += 1;
      if (query.isLoading) isLoading = true;
      if (query.isError) chainsWithError += 1;
      const data = query.data;
      if (!data) continue;
      for (let j = 0; j < slots.length; j++) {
        const slot = slots[j]!;
        const item = data[j];
        if (!item || item.status !== "success") continue;
        const pos = item.result as {
          sizeE18: bigint;
          entryPriceE18: bigint;
          marginReserved: bigint;
          lastFundingVersion: bigint;
        };
        if (pos.sizeE18 === 0n) continue;
        const side: "long" | "short" = pos.sizeE18 > 0n ? "long" : "short";
        const absSize = pos.sizeE18 < 0n ? -pos.sizeE18 : pos.sizeE18;
        const markE18 =
          options.markPriceE18?.[chain.chainId]?.[slot.marketKey] ?? pos.entryPriceE18;
        // notional = |size| * mark / 1e18 (size and price both 1e18 → divide once).
        const notionalRaw = (absSize * markE18) / 10n ** 18n;
        // Convert 1e18 → decimal float, ceiling at JS-safe range.
        const notionalUsdc =
          notionalRaw > 0n ? Number(notionalRaw) / 1e18 : null;
        rows.push({
          chainId: chain.chainId,
          marketKey: slot.marketKey,
          marketId: slot.marketId,
          sizeE18: pos.sizeE18,
          entryPriceE18: pos.entryPriceE18,
          marginReserved: pos.marginReserved,
          lastFundingVersion: pos.lastFundingVersion,
          side,
          notionalUsdc,
        });
      }
    }

    // Sort by absolute notional desc — largest exposure first.
    rows.sort((a, b) => (b.notionalUsdc ?? 0) - (a.notionalUsdc ?? 0));

    return {
      rows,
      isLoading,
      // Only flag isError when EVERY attempted chain failed. Partial
      // errors still surface the live half (matches useMultiHubMarketList).
      isError: queriesAttempted > 0 && chainsWithError === queriesAttempted,
      chains: PERPS_CHAINS,
    };
  }, [perChain, queries, trader, options.markPriceE18]);
}
