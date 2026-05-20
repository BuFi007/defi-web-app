/**
 * React hook for submitting contract writes via the ZeroDev session-key
 * UserOp path through a Pimlico bundler.
 *
 * Wave F4 (PR #55 stack). PR #55 hydrates the kernel account into
 * memory. This hook wraps that kernel in a `KernelAccountClient` from
 * `pimlico-client.ts` and exposes the same `submit(...)` -> `{ txHash }`
 * shape that PR #44's `useSimulatedWrite` exposes for the EOA path —
 * so the `useFastPerpWrite` composer can swap them transparently and
 * call sites don't have to know which rail is firing.
 *
 *   { address, abi, functionName, args, value }
 *      │
 *      │ encodeFunctionData → calldata
 *      ▼
 *   kernelClient.sendTransaction({ to, data, value })
 *      │  ZeroDev wraps it in a UserOp, session key signs,
 *      │  Pimlico submits + waits for inclusion
 *      ▼
 *   tx hash (the UserOp's bundling tx, by default)
 *
 * What this hook deliberately DOES NOT do:
 *   - Doesn't simulate the call. The kernel client validates the
 *     UserOp via `eth_estimateUserOperationGas` against the bundler,
 *     which catches reverts before submission. A pre-simulate would
 *     double the RPC round-trips for no extra safety on the AA path.
 *   - Doesn't manage the session key lifecycle. That's `useSessionKey`
 *     from PR #55 — enable/revoke/refresh live there. This hook is
 *     READ-ONLY against `useSessionKey()` state.
 *   - Doesn't catch errors silently. The promise rejects on any
 *     failure; the composer (`useFastPerpWrite`) decides whether to
 *     fall back to the EOA path.
 */

"use client";

import { useCallback, useMemo } from "react";
import {
  encodeFunctionData,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from "viem";
import { useChainId } from "wagmi";

import { useSessionKey } from "./use-session-key";
import {
  buildKernelClient,
  isPimlicoConfigured,
} from "./pimlico-client";

export interface SessionKeyWriteArgs<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable"> =
    ContractFunctionName<TAbi, "nonpayable" | "payable">,
> {
  address: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", TFunctionName>;
  /** Wei value to forward. Defaults to 0n. */
  value?: bigint;
}

export interface SessionKeyWriteResult {
  /**
   * The transaction hash returned by the bundler. For most Pimlico
   * deployments this is the UserOp's inclusion tx hash; for some it's
   * the userOpHash before inclusion. Either way it's a 0x-prefixed
   * hex string callers can pass to `useWaitForTransactionReceipt` —
   * the kernel client's `sendTransaction` waits for receipt before
   * resolving, so by the time we get here the tx is mined.
   */
  txHash: Hex;
}

export interface UseSessionKeyWriteApi {
  /**
   * True iff a session key is loaded AND Pimlico is configured for
   * the active chain. The composer checks this before attempting the
   * UserOp path — if false, it goes straight to the EOA fallback
   * without an exception round-trip.
   */
  isActive: boolean;
  /**
   * Same `isActive` decomposed so callers can show diagnostics:
   *   - `hasSessionKey`  PR #55 hook says yes, kernel is hydrated.
   *   - `hasPimlico`     env vars are set for the active chain id.
   */
  hasSessionKey: boolean;
  hasPimlico: boolean;
  /** Active chain the kernel + bundler are bound to. */
  chainId: number;
  /** Submit a contract call via the kernel + Pimlico bundler. */
  submit: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    args: SessionKeyWriteArgs<TAbi, TFunctionName>,
  ) => Promise<SessionKeyWriteResult>;
}

export function useSessionKeyWrite(): UseSessionKeyWriteApi {
  const chainId = useChainId();
  const session = useSessionKey();
  const hasSessionKey =
    session.status === "active" && session.kernelAccount !== null;
  const hasPimlico = useMemo(() => isPimlicoConfigured(chainId), [chainId]);
  const isActive = hasSessionKey && hasPimlico;

  const submit = useCallback(
    async <
      TAbi extends Abi,
      TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
    >(
      args: SessionKeyWriteArgs<TAbi, TFunctionName>,
    ): Promise<SessionKeyWriteResult> => {
      // Guard rails — every branch points at the composer's fallback so
      // the error message is actionable from the call site.
      if (!session.kernelAccount) {
        throw new Error(
          "use-session-key-write: no kernel account loaded; " +
            "session key may be idle / expired — caller should fall back to EOA",
        );
      }
      if (!hasPimlico) {
        throw new Error(
          `use-session-key-write: NEXT_PUBLIC_PIMLICO_BUNDLER_URL not set ` +
            `for chainId=${chainId} — caller should fall back to EOA`,
        );
      }

      const client = buildKernelClient({
        // Cast: `useSessionKey` returns the raw `createKernelAccount`
        // result; `buildKernelClient` expects the viem SmartAccount
        // shape. The two are the same object at runtime — ZeroDev's
        // kernel implements the SmartAccount interface — but the
        // generic narrowing differs, so we widen here.
        kernel: session.kernelAccount as unknown as Parameters<
          typeof buildKernelClient
        >[0]["kernel"],
        chainId,
      });

      // viem's encodeFunctionData generics over (abi, functionName, args)
      // and the narrowing through our generic hook signature loses the
      // tuple-args relationship. We cast the call once at the boundary
      // — runtime is identical, only the inference is widened.
      const data: Hex = encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const txHash = (await client.sendTransaction({
        to: args.address,
        data,
        value: args.value ?? 0n,
      })) as Hex;

      return { txHash };
    },
    [session.kernelAccount, hasPimlico, chainId],
  );

  return {
    isActive,
    hasSessionKey,
    hasPimlico,
    chainId,
    submit,
  };
}
