/**
 * Composer hook: prefers the ZeroDev session-key UserOp path
 * (`useSessionKeyWrite`) and falls back to a wagmi EOA write when
 * session keys are unavailable, expired, mid-failure, or Pimlico is
 * not configured for the chain.
 *
 * Wave F4 (PR #55 stack). This is the PRIMITIVE LAYER caller-facing
 * surface. Call sites in trade-island / order-entry-cta / a future
 * `<MarginPanel />` mount this single hook and stop caring about
 * which rail signed and submitted the tx.
 *
 *   useFastPerpWrite()
 *      ├── isActive   true ⇒ next submit will try the session-key path first
 *      └── submit({ address, abi, functionName, args, value })
 *            │
 *            ├── if session key is active:
 *            │     try useSessionKeyWrite().submit(...)
 *            │     ├── ok       → { txHash, mode: "session-key" }
 *            │     └── threw    → log + fall through to EOA
 *            │
 *            └── EOA fallback (wagmi):
 *                  walletClient.writeContract(...)
 *                  → { txHash, mode: "eoa" }
 *
 * The fallback is intentionally inline and not behind `useSimulatedWrite`
 * (PR #44) because that hook is not on this base branch. When PR #44
 * lands, swap the `eoaSubmit` body for `useSimulatedWrite().submit(...)`
 * — the public API of this composer doesn't change.
 *
 * Why a try/catch around the session-key path:
 *   The kernel client can fail mid-submit for transient reasons that
 *   don't reflect a permanent misconfig (Pimlico rate-limit hiccup,
 *   bundler 500, RPC blip on `eth_estimateUserOperationGas`). The
 *   user just wants their order placed; falling through to the EOA
 *   sign-and-send is the right UX. A persistent failure mode (policy
 *   rejection, kernel not deployed, etc.) will of course also fail
 *   through to the EOA — which is exactly what the user was about to
 *   do anyway before session keys existed.
 */

"use client";

import { useCallback } from "react";
import {
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from "viem";
import { useAccount, useChainId, useWalletClient } from "wagmi";

import {
  useSessionKeyWrite,
  type SessionKeyWriteArgs,
} from "./use-session-key-write";

export type FastPerpWriteMode = "session-key" | "eoa";

export interface FastPerpWriteArgs<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable"> =
    ContractFunctionName<TAbi, "nonpayable" | "payable">,
> extends SessionKeyWriteArgs<TAbi, TFunctionName> {
  // Same shape as the session-key submit args — the composer is a
  // drop-in replacement.
  _reservedFutureFlags?: never;
}

export interface FastPerpWriteResult {
  txHash: Hex;
  /** Which rail actually submitted the tx. */
  mode: FastPerpWriteMode;
  /**
   * Populated when the session-key path was attempted but failed and
   * we fell through to EOA. Useful for surfacing a tooltip-level
   * diagnostic without breaking the success path.
   */
  fallbackReason?: string;
}

export interface UseFastPerpWriteApi {
  /**
   * True iff the next `submit()` will attempt the session-key path
   * first. Surfaces straight from `useSessionKeyWrite().isActive`.
   * Call sites use this to render a "Zero-popup mode active" pill.
   */
  isActive: boolean;
  /** Active chain id the hook is bound to. */
  chainId: number;
  /**
   * Submit a contract write. Same shape as
   * `useSessionKeyWrite().submit` so swapping is one line.
   */
  submit: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    args: FastPerpWriteArgs<TAbi, TFunctionName>,
  ) => Promise<FastPerpWriteResult>;
}

export function useFastPerpWrite(): UseFastPerpWriteApi {
  const chainId = useChainId();
  const sessionKey = useSessionKeyWrite();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId });

  /**
   * EOA fallback inline. When PR #44 lands `useSimulatedWrite` we
   * replace this body — the composer's public API is unaffected.
   */
  const eoaSubmit = useCallback(
    async <
      TAbi extends Abi,
      TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
    >(
      args: FastPerpWriteArgs<TAbi, TFunctionName>,
    ): Promise<Hex> => {
      if (!walletClient) {
        throw new Error(
          "use-fast-perp-write: no wagmi wallet client — connect a wallet to submit",
        );
      }
      if (!address) {
        throw new Error("use-fast-perp-write: no connected account");
      }
      // wagmi's WalletClient exposes writeContract directly. We cast
      // the args generics through any once at the boundary — the
      // runtime shape matches exactly what the call site supplied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writeArgs: any = {
        address: args.address as Address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
        value: args.value ?? 0n,
        account: address,
        chain: walletClient.chain,
      };
      const hash = (await walletClient.writeContract(writeArgs)) as Hex;
      return hash;
    },
    [walletClient, address],
  );

  const submit = useCallback(
    async <
      TAbi extends Abi,
      TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
    >(
      args: FastPerpWriteArgs<TAbi, TFunctionName>,
    ): Promise<FastPerpWriteResult> => {
      // Happy path: session key active + Pimlico configured.
      if (sessionKey.isActive) {
        try {
          const result = await sessionKey.submit(args);
          return { txHash: result.txHash, mode: "session-key" };
        } catch (err) {
          // Transient or permanent — either way we fall through.
          // Permanent failures will also fail the EOA path with the
          // same root cause (e.g. user has no USDC for margin), so
          // the second leg's error is the actionable one to surface.
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(
            "[fast-write] session-key submit failed, falling back to EOA:",
            message,
          );
          const txHash = await eoaSubmit(args);
          return { txHash, mode: "eoa", fallbackReason: message };
        }
      }

      // Cold fallback: no session key, no try/catch needed.
      const txHash = await eoaSubmit(args);
      return { txHash, mode: "eoa" };
    },
    [sessionKey, eoaSubmit],
  );

  return {
    isActive: sessionKey.isActive,
    chainId,
    submit,
  };
}
