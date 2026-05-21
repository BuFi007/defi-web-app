"use client";

/**
 * Optimistic place-order with rollback.
 *
 * Wraps the existing `usePlaceOrder()` mutation (apps/web/lib/perps/hooks.ts)
 * with TanStack Query optimistic-update plumbing so the positions list
 * gains the new row the *instant* the user signs — well before the matcher
 * round-trips the intent through /perps/intents and the keeper settles
 * on-chain.
 *
 * Mechanics (canonical TanStack pattern):
 *   1. `onMutate` — snapshot the cached `["perps", "positions", ...]`
 *      query data, then insert an optimistic `PerpsPositionDto` derived
 *      from the order args + current mark price.
 *   2. `onSuccess` — keep the optimistic row (the matcher will replace it
 *      with the real fill on the next refetch). We also invalidate the
 *      positions cache so the next poll reconciles.
 *   3. `onError` — restore the snapshot. The optimistic row vanishes; the
 *      user sees the toast / inline revert reason from `simError`.
 *
 * Why not modify `usePlaceOrder` in place: the existing hook is consumed
 * by panels.tsx + trade-drawer.tsx + the perps-replacement-agent, so
 * touching its public shape blast-radiuses the whole perp UI. Layering on
 * top keeps the original hook unchanged and lets callers opt-in.
 */

import { useCallback, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";

import { HUBS } from "@bufi/location/hubs";

import {
  usePlaceOrder,
  type UsePlaceOrderInput,
  type UsePlaceOrderResult,
} from "./hooks";
import type { PerpsPositionDto } from "./client";
import { getPerpsReplacementDevWallet } from "./dev-mock-wallet";

const DEFAULT_CHAIN_ID = 5042002 as const;

/**
 * Same key-builder as `usePositions()` in hooks.ts. Kept in sync manually
 * because hooks.ts doesn't export it; if you rename the position cache
 * key there, rename here too.
 */
function positionsQueryKey(chainId: number, address: `0x${string}` | undefined) {
  return ["perps", "positions", chainId, address?.toLowerCase()] as const;
}

/**
 * Build an optimistic `PerpsPositionDto` from the order args. We mirror
 * the real DTO shape so consumers can render the pending row through the
 * same code path as a confirmed position — no special-cased UI branch.
 *
 * Honest math:
 *   - `sizeUsdc`   — passed through from the order input
 *   - `entryPrice` — assumed = `priceE18` for limit, oracle mid for
 *                    market (we don't have mid here, so caller injects)
 *   - `requiredMargin` = sizeUsdc / leverage (USDC base units; matches
 *                       the float helper requiredMarginFloat)
 *   - `markPrice`  — same as entry until the keeper settles
 *
 * We tag the optimistic row with `__pending: true` (a synthetic field
 * dropped at runtime when the real keeper row replaces it) so the
 * positions view can render a subtle pulse on the optimistic entry.
 */
export interface OptimisticPositionTag {
  /** True iff this position row hasn't been confirmed by the matcher yet. */
  isPending?: boolean;
  /** Client-side timestamp the optimistic row was inserted. */
  pendingSince?: number;
}

export type OptimisticPerpsPositionDto = PerpsPositionDto & OptimisticPositionTag;

function buildOptimisticPosition(args: {
  input: UsePlaceOrderInput;
  /** Oracle mid at sim-time (UI float, USD-per-base). Optional. */
  markPriceFloat?: number;
}): OptimisticPerpsPositionDto {
  const { input, markPriceFloat } = args;
  const sizeUsdcNum = Number(input.sizeUsdc) || 0;
  const leverage = Math.max(1, input.leverage || 1);
  const requiredMarginNum = sizeUsdcNum / leverage;
  // Limit orders carry their own priceE18; market orders take the live
  // mark (a UI float we promote to 1e18 fixed-point). If neither is
  // available, fall back to 0 — the matcher will overwrite on settle.
  const entryPriceE18 = (() => {
    if (input.orderType === "limit" && input.priceE18) return input.priceE18;
    if (markPriceFloat && Number.isFinite(markPriceFloat)) {
      // 18-decimal fixed-point — string form so it slots straight into
      // PerpsPositionDto (which uses string for bigint fields).
      try {
        return BigInt(Math.round(markPriceFloat * 1e18)).toString();
      } catch {
        return "0";
      }
    }
    return "0";
  })();
  return {
    marketId: input.marketId,
    side: input.side,
    sizeUsdc: input.sizeUsdc,
    leverage,
    fee: "0",
    markPrice: entryPriceE18,
    requiredMargin: requiredMarginNum.toString(),
    entryPriceE18,
    isPending: true,
    pendingSince: Date.now(),
  };
}

export interface UseOptimisticPlaceOrderInput extends UsePlaceOrderInput {
  /** Live mark price in UI float terms, used for optimistic entry on market orders. */
  markPriceFloat?: number;
}

// Alias rather than empty-interface — eslint's no-empty-object-type rule
// flags `interface Foo extends Bar {}` as equivalent to its supertype.
// Type-aliasing preserves the same public shape with no behaviour change.
export type UseOptimisticPlaceOrderResult = UsePlaceOrderResult;

export function useOptimisticPlaceOrder() {
  const placeOrder = usePlaceOrder();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  // Stable ref so we never go stale inside an in-flight mutation.
  const lastSnapshotRef = useRef<
    Array<{ key: readonly unknown[]; data: PerpsPositionDto[] | undefined }>
  >([]);

  const resolveTarget = useCallback((): `0x${string}` | undefined => {
    return (
      (devWallet?.address as `0x${string}` | undefined) ??
      (address as `0x${string}` | undefined)
    );
  }, [address, devWallet]);

  return useMutation<
    UsePlaceOrderResult,
    Error,
    UseOptimisticPlaceOrderInput,
    {
      snapshots: Array<{ key: readonly unknown[]; data: PerpsPositionDto[] | undefined }>;
    }
  >({
    mutationKey: ["perps", "place-order-optimistic"],
    mutationFn: async (input) => placeOrder.mutateAsync(input),
    onMutate: async (input) => {
      const target = resolveTarget();
      if (!target) {
        // No wallet, no cache to optimistically update — let the underlying
        // mutation surface the error.
        return { snapshots: [] };
      }
      const chainId =
        input.chainId ?? devWallet?.chainId ?? wagmiChainId ?? DEFAULT_CHAIN_ID;

      // Cancel any in-flight refetches so they don't overwrite our
      // optimistic insertion mid-mutation.
      await queryClient.cancelQueries({ queryKey: ["perps", "positions"] });

      // The positions hook keys by (chainId, address). We also write to
      // both hub chains' keys so multi-hub views (Arc + Fuji) see the
      // pending row regardless of which hub the user is currently on —
      // matches the multi-hub market list pattern in hooks.ts.
      const keysToTouch = new Set<string>();
      const snapshots: Array<{ key: readonly unknown[]; data: PerpsPositionDto[] | undefined }> = [];

      const touch = (chainIdToTouch: number) => {
        const key = positionsQueryKey(chainIdToTouch, target);
        const k = JSON.stringify(key);
        if (keysToTouch.has(k)) return;
        keysToTouch.add(k);
        const prev = queryClient.getQueryData<PerpsPositionDto[]>(key);
        snapshots.push({ key, data: prev });
        const optimistic = buildOptimisticPosition({
          input,
          markPriceFloat: input.markPriceFloat,
        });
        const next: OptimisticPerpsPositionDto[] = [optimistic, ...(prev ?? [])];
        queryClient.setQueryData<PerpsPositionDto[]>(key, next);
      };

      touch(chainId);
      // Be defensive — surface the pending row on the canonical hub keys
      // even if the user's wagmi chain hasn't switched yet. Cheap and
      // makes the UX feel instant across the multi-hub pickers.
      touch(HUBS.arc.chainId);
      touch(HUBS.fuji.chainId);

      lastSnapshotRef.current = snapshots;
      return { snapshots };
    },
    onError: (_err, _input, context) => {
      // Roll back EVERY snapshot we touched. Without this an order that
      // reverts in simulateContract OR is rejected by the matcher leaves
      // a ghost pending row that never resolves.
      const snapshots = context?.snapshots ?? lastSnapshotRef.current;
      for (const { key, data } of snapshots) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      // Whether success or error, ask the positions query to refetch so
      // the real on-chain state replaces the optimistic row (or restores
      // a clean cache after rollback). The underlying `usePlaceOrder`
      // already invalidates `["perps", "positions"]` on success; we add
      // a settled-level invalidate so failure paths also reconcile.
      void queryClient.invalidateQueries({ queryKey: ["perps", "positions"] });
    },
  });
}

export { buildOptimisticPosition };
