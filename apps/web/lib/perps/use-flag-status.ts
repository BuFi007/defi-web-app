"use client";

/**
 * Read flagging state for a perps position from the on-chain
 * FxLiquidationEngine.
 *
 *  - `flaggedAt[marketId][trader]` is a public mapping: 0 = not flagged,
 *    non-zero = unix-second when the flag was raised.
 *  - `liquidationConfig()` returns `(bountyBps, bountyCap, flagDelay)`;
 *    `flagDelay` is the cooldown after which a flagged account becomes
 *    liquidatable. PR #28 enforces a 60s minimum.
 *
 * The hook returns enough state for the UI to render:
 *  - "not flagged" → null countdown, hide the row
 *  - "flagged, N seconds remaining" → tick client-side from `flaggedAt + flagDelay`
 *  - "liquidatable now" → countdown <= 0
 *
 * Polling: `flaggedAt` and `flagDelay` are polled every 30 seconds (matches
 * the brief's "don't hammer RPC every second" guidance). The visible
 * countdown derives client-side from `clientNow` — `setInterval(1000)`
 * lives in the consuming component so the hook stays cheap.
 */

import { useMemo } from "react";
import type { Hex } from "viem";
import { useChainId, useReadContract } from "wagmi";

import {
  CONTRACTS,
  FxHealthCheckerAbi,
  FxLiquidationEngineAbi,
} from "@bufi/contracts";

const POLL_MS = 30_000;
const DEFAULT_CHAIN_ID = 5042002 as const;

export interface FlagStatus {
  /** Address of the FxLiquidationEngine on the active chain, or undefined. */
  liquidationEngine: `0x${string}` | undefined;
  /** Raw on-chain `flaggedAt` (unix seconds). `0n` when not flagged. */
  flaggedAt: bigint | null;
  /** Configured `flagDelay` in seconds. */
  flagDelay: bigint | null;
  /** Unix seconds when this position becomes liquidatable. */
  readyAt: number | null;
  /** True iff `flaggedAt > 0` and the position is currently flagged. */
  isFlagged: boolean;
  /** Whether reads are still in flight. */
  isLoading: boolean;
  /** Whether either read errored. */
  isError: boolean;
}

function resolveLiquidationEngine(chainId: number): `0x${string}` | undefined {
  const contracts = (CONTRACTS as Record<number, { perps: { liquidationEngine?: `0x${string}` } }>)[
    chainId
  ];
  return contracts?.perps.liquidationEngine;
}

/**
 * Read the flag state for `(marketId, trader)` on the active chain. The
 * hook is safe to call with undefined args — reads are gated and return
 * a sentinel "not flagged" state.
 */
export function useFlagStatus(args: {
  marketId: Hex | undefined;
  trader: `0x${string}` | undefined;
  chainIdOverride?: number;
}): FlagStatus {
  const wagmiChainId = useChainId();
  const chainId =
    args.chainIdOverride ?? (wagmiChainId || DEFAULT_CHAIN_ID);

  const liquidationEngine = useMemo(
    () => resolveLiquidationEngine(chainId),
    [chainId],
  );

  const canRead = Boolean(
    liquidationEngine && args.marketId && args.trader,
  );

  const flaggedAtRead = useReadContract({
    address: liquidationEngine,
    abi: FxLiquidationEngineAbi,
    functionName: "flaggedAt",
    args: canRead
      ? ([args.marketId as Hex, args.trader as `0x${string}`] as const)
      : undefined,
    query: {
      enabled: canRead,
      refetchInterval: POLL_MS,
      staleTime: POLL_MS / 2,
    },
  });

  const configRead = useReadContract({
    address: liquidationEngine,
    abi: FxLiquidationEngineAbi,
    functionName: "liquidationConfig",
    query: {
      enabled: Boolean(liquidationEngine),
      // flagDelay rarely changes — poll less aggressively than flaggedAt.
      refetchInterval: POLL_MS * 4,
      staleTime: POLL_MS * 2,
    },
  });

  const flaggedAt = (flaggedAtRead.data as bigint | undefined) ?? null;
  // liquidationConfig returns the struct as a tuple: [bountyBps, bountyCap, flagDelay].
  const configTuple = configRead.data as
    | readonly [number, bigint, bigint]
    | undefined;
  const flagDelay = configTuple ? configTuple[2] : null;

  const isFlagged = Boolean(flaggedAt && flaggedAt > 0n);
  const readyAt =
    isFlagged && flagDelay !== null
      ? Number((flaggedAt as bigint) + flagDelay)
      : null;

  return {
    liquidationEngine,
    flaggedAt,
    flagDelay,
    readyAt,
    isFlagged,
    isLoading: flaggedAtRead.isLoading || configRead.isLoading,
    isError: flaggedAtRead.isError || configRead.isError,
  };
}

/**
 * Read `FxHealthChecker.healthFactor(marketId, trader)`. Returns the raw
 * `ratioBps` (1e4 scale) — the consumer wraps with `healthFactorFromBps`
 * to get a decimal HF and `classifyHealthBand` to bucket it. Refresh is
 * coupled to position polling (every ~30s); the consumer can keep the
 * live HF inline without re-reading from server-side /perps/positions.
 */
export function useHealthFactor(args: {
  marketId: Hex | undefined;
  trader: `0x${string}` | undefined;
  chainIdOverride?: number;
  enabled?: boolean;
}): { ratioBps: bigint | null; isLoading: boolean; isError: boolean } {
  const wagmiChainId = useChainId();
  const chainId =
    args.chainIdOverride ?? (wagmiChainId || DEFAULT_CHAIN_ID);

  const contracts = (CONTRACTS as Record<number, { perps: { healthChecker?: `0x${string}` } }>)[
    chainId
  ];
  const healthChecker = contracts?.perps.healthChecker;

  const canRead = Boolean(
    healthChecker && args.marketId && args.trader && (args.enabled ?? true),
  );

  const read = useReadContract({
    address: healthChecker,
    abi: FxHealthCheckerAbi,
    functionName: "healthFactor",
    args: canRead
      ? ([args.marketId as Hex, args.trader as `0x${string}`] as const)
      : undefined,
    query: {
      enabled: canRead,
      refetchInterval: POLL_MS,
      staleTime: POLL_MS / 2,
    },
  });

  return {
    ratioBps: (read.data as bigint | undefined) ?? null,
    isLoading: read.isLoading,
    isError: read.isError,
  };
}

/**
 * Read `FxHealthChecker.isLiquidatable(marketId, trader)`. Used by the
 * rescind CTA to decide whether the on-chain call will revert
 * (`AccountStillLiquidatable`) — a flagged position with HF >= 1 can be
 * rescinded; otherwise the CTA stays hidden / disabled.
 */
export function useIsLiquidatable(args: {
  marketId: Hex | undefined;
  trader: `0x${string}` | undefined;
  chainIdOverride?: number;
  enabled?: boolean;
}): { isLiquidatable: boolean | null; isLoading: boolean } {
  const wagmiChainId = useChainId();
  const chainId =
    args.chainIdOverride ?? (wagmiChainId || DEFAULT_CHAIN_ID);

  const contracts = (CONTRACTS as Record<number, { perps: { healthChecker?: `0x${string}` } }>)[
    chainId
  ];
  const healthChecker = contracts?.perps.healthChecker;

  const canRead = Boolean(
    healthChecker && args.marketId && args.trader && (args.enabled ?? true),
  );

  const read = useReadContract({
    address: healthChecker,
    abi: FxHealthCheckerAbi,
    functionName: "isLiquidatable",
    args: canRead
      ? ([args.marketId as Hex, args.trader as `0x${string}`] as const)
      : undefined,
    query: {
      enabled: canRead,
      refetchInterval: POLL_MS,
      staleTime: POLL_MS / 2,
    },
  });

  return {
    isLiquidatable: (read.data as boolean | undefined) ?? null,
    isLoading: read.isLoading,
  };
}
