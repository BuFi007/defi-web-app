"use client";

/**
 * Write hook for FxLiquidationEngine.rescindFlag(marketId, trader).
 *
 * The function is permissionless — any wallet can clear the flag on a
 * recovered (HF >= 1) position. PR #28 introduces:
 *   - `rescindFlag(bytes32 marketId, address trader)` external
 *   - reverts `AccountStillLiquidatable` when HF < 1
 *   - emits `AccountFlagRescinded(marketId, trader, caller, auto)`
 *     with `auto = false` for direct calls
 *
 * Feature flag: `NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED`.
 *   - default OFF: PR #28 hasn't deployed yet; calls to the current
 *     liquidationEngine address would revert with "unknown selector"
 *   - flip ON in `.env.local` once the v2 engine address is wired
 *
 * When OFF, `enabled = false` and the hook returns a sentinel state
 * the UI uses to render a disabled CTA + tooltip "Available after
 * liquidation engine v2 deploys".
 *
 * The shape mirrors the file-map note in the brief: this is a
 * write-side hook. We don't depend on PR #44's `useSimulatedWrite`
 * (which hasn't merged on this base branch); instead we use viem's
 * `simulateContract` via `usePublicClient().simulateContract` to surface
 * the `AccountStillLiquidatable` revert reason inline before the wallet
 * popup. When PR #44 lands, swap in `useSimulatedWrite` here without
 * touching consumers.
 */

import { useCallback, useState } from "react";
import { parseAbi, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";

import { CONTRACTS } from "@bufi/contracts";

/**
 * Minimal ABI for the new `rescindFlag` function shipped by fx-telarana
 * PR #28. We define it locally (not via @bufi/contracts) so the scaffold
 * compiles before the auto-generated ABI in `packages/contracts/src/abis`
 * is regenerated against the new artifact. The 4-byte selector is
 * derived purely from `(bytes32,address)` so this matches the live
 * function once the contracts are broadcast.
 *
 * We also include the named error so viem can decode the revert reason.
 */
const RESCIND_FLAG_ABI = parseAbi([
  "function rescindFlag(bytes32 marketId, address trader)",
  "error AccountStillLiquidatable()",
]);

const DEFAULT_CHAIN_ID = 5042002 as const;

/**
 * Module-level feature flag. Read once at import — Next.js inlines
 * `NEXT_PUBLIC_*` at build time so this is the cheap path. Default OFF
 * until the v2 contracts are broadcast.
 */
export const RESCIND_FLAG_ENABLED =
  process.env.NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED === "1";

export interface UseRescindFlagState {
  /** Whether the feature flag is on — UI uses this to enable/disable the CTA. */
  enabled: boolean;
  /** The address of the FxLiquidationEngine on the active chain. */
  liquidationEngine: `0x${string}` | undefined;
  /** Whether a rescind call is in flight. */
  isLoading: boolean;
  /** Last error message (revert reason if available). */
  error: string | null;
  /** Last successful tx hash, if any. */
  txHash: Hex | null;
}

export interface UseRescindFlagResult extends UseRescindFlagState {
  rescind: (args: {
    marketId: Hex;
    trader: `0x${string}`;
  }) => Promise<Hex | null>;
  reset: () => void;
}

/**
 * Decode an Error-like value into a user-facing string. Prefers the
 * named revert (`AccountStillLiquidatable`) so the UI can show "Position
 * became unhealthy — cannot rescind".
 */
function decodeRescindError(err: unknown): string {
  if (!err) return "Unknown error";
  const message = err instanceof Error ? err.message : String(err);
  // viem's contract-revert messages look like:
  //   "ContractFunctionExecutionError: ... reverted with the following reason: AccountStillLiquidatable()"
  // or carry `errorName` on the cause when decoded against the ABI.
  if (/AccountStillLiquidatable/i.test(message)) {
    return "Position became unhealthy — cannot rescind";
  }
  if (/User rejected|User denied/i.test(message)) {
    return "Cancelled in wallet";
  }
  // Keep the first line; viem stack traces get long.
  const firstLine = message.split("\n")[0] ?? message;
  return firstLine.slice(0, 240);
}

export function useRescindFlag(): UseRescindFlagResult {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const chainId: number = wagmiChainId || DEFAULT_CHAIN_ID;
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const liquidationEngine = (
    CONTRACTS as Record<
      number,
      { perps: { liquidationEngine?: `0x${string}` } }
    >
  )[chainId]?.perps.liquidationEngine;

  const [state, setState] = useState<UseRescindFlagState>({
    enabled: RESCIND_FLAG_ENABLED,
    liquidationEngine,
    isLoading: false,
    error: null,
    txHash: null,
  });

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, txHash: null }));
  }, []);

  const rescind = useCallback(
    async (args: { marketId: Hex; trader: `0x${string}` }): Promise<Hex | null> => {
      if (!RESCIND_FLAG_ENABLED) {
        setState((prev) => ({
          ...prev,
          error:
            "Rescind flag is disabled. Set NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED=true once the v2 engine deploys.",
        }));
        return null;
      }
      if (!address) {
        setState((prev) => ({ ...prev, error: "Connect a wallet first." }));
        return null;
      }
      if (!publicClient) {
        setState((prev) => ({
          ...prev,
          error: "Public client not ready for this chain.",
        }));
        return null;
      }
      if (!liquidationEngine) {
        setState((prev) => ({
          ...prev,
          error: `No liquidationEngine address configured for chain ${chainId}.`,
        }));
        return null;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        txHash: null,
      }));

      try {
        // Simulate first so AccountStillLiquidatable surfaces before the
        // wallet popup. When PR #44 (useSimulatedWrite) lands, this block
        // becomes a single hook call.
        //
        // The `as never` cast collapses wagmi's chain-union over
        // publicClient (which produces a TS2590 "type too complex" on
        // the parameters intersection). The runtime call is unaffected;
        // viem still validates marketId/trader against RESCIND_FLAG_ABI.
        await (
          publicClient as unknown as {
            simulateContract: (args: {
              account: `0x${string}`;
              address: `0x${string}`;
              abi: typeof RESCIND_FLAG_ABI;
              functionName: "rescindFlag";
              args: readonly [Hex, `0x${string}`];
            }) => Promise<unknown>;
          }
        ).simulateContract({
          account: address,
          address: liquidationEngine,
          abi: RESCIND_FLAG_ABI,
          functionName: "rescindFlag",
          args: [args.marketId, args.trader],
        });

        const hash = await writeContractAsync({
          address: liquidationEngine,
          abi: RESCIND_FLAG_ABI,
          functionName: "rescindFlag",
          args: [args.marketId, args.trader],
        });

        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: null,
          txHash: hash,
        }));
        return hash;
      } catch (err) {
        const decoded = decodeRescindError(err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: decoded,
          txHash: null,
        }));
        return null;
      }
    },
    [address, chainId, liquidationEngine, publicClient, writeContractAsync],
  );

  return {
    ...state,
    enabled: RESCIND_FLAG_ENABLED,
    liquidationEngine,
    rescind,
    reset,
  };
}
