"use client";

/**
 * useSimulatedWrite — wrap every on-chain write with `simulateContract`
 * so revert reasons surface BEFORE the wallet popup.
 *
 * UX trust signal: today users sign, gas burns, then they see a revert.
 * With this hook we eagerly simulate against the live chain state; if
 * the call would revert, we return a `simError` with the decoded reason
 * (e.g. "SkewCapExceeded(M1, 4521000, 4000000)") and never open the
 * wallet popup at all. If simulation passes, we forward the prepared
 * request to wagmi's `writeContractAsync` for the real signature.
 *
 * Pure viem path (`simulateThenWrite`) is exported for callers that
 * already own `publicClient` + `walletClient` (e.g. existing
 * `useLendingAction` plumbing). The React hook wraps the same logic
 * with wagmi state so components can call `submit()` directly.
 */

import { useCallback, useState } from "react";
import type {
  Abi,
  Address,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

export interface SimulatedWriteArgs<TAbi extends Abi = Abi> {
  address: Address;
  abi: TAbi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  /** Optional override; defaults to the connected account. */
  account?: Address;
}

export interface SimError {
  /** One-line summary — fits in a toast title. */
  short: string;
  /** Multiline, joined with `\n` — fits in a toast description. */
  full: string;
  /** Decoded custom-error name if viem could parse it from revert data. */
  reason?: string;
}

export interface SimulatedWriteResult {
  txHash?: Hex;
  simError?: SimError;
}

/**
 * Convert any viem revert/sim error into a UI-friendly shape.
 *
 * viem's `ContractFunctionExecutionError` carries:
 *   - `shortMessage`: human one-liner
 *   - `metaMessages`: array of context lines (function name, args, sender)
 *   - `cause.data.errorName` + `cause.data.args` when the revert is a
 *     known custom error from the ABI
 *
 * We defensively `any`-cast because viem's error hierarchy is wide and
 * we don't want a stale typecheck to drop the decoded reason on the
 * floor.
 */
export function prettifySimError(err: unknown): SimError {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const short: string =
    e?.shortMessage ??
    e?.message ??
    "Transaction would revert (no message)";
  const metas: string[] = Array.isArray(e?.metaMessages)
    ? e.metaMessages
    : [];
  const full = metas.length > 0 ? metas.join("\n") : short;

  // Custom-error decoding lives on `.cause.data` (ContractFunctionRevertedError).
  const reason: string | undefined =
    e?.cause?.data?.errorName ??
    e?.data?.errorName ??
    e?.cause?.reason ??
    undefined;

  return { short, full, reason };
}

/**
 * Pure helper: simulate, then write. Throws on simulation failure with
 * the prettified message; throws on user-rejected wallet popup with the
 * raw wallet error. Callers that want the structured `simError` shape
 * should use the hook below.
 */
export async function simulateThenWrite(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  call: SimulatedWriteArgs;
}): Promise<Hex> {
  const { publicClient, walletClient, account, call } = params;
  // simulateContract reverts here BEFORE we ever ask the user to sign.
  // Cast to `any` to escape the generic-heavy return-type union; runtime
  // is fully validated by viem.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim = (await (publicClient as any).simulateContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    account,
    value: call.value,
  })) as { request: unknown };
  // `request` is pre-validated; forward as-is to the wallet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await walletClient.writeContract(sim.request as any)) as Hex;
}

export interface UseSimulatedWriteResult {
  submit: (args: SimulatedWriteArgs) => Promise<SimulatedWriteResult>;
  simulating: boolean;
  submitting: boolean;
}

export function useSimulatedWrite(): UseSimulatedWriteResult {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [simulating, setSimulating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (args: SimulatedWriteArgs): Promise<SimulatedWriteResult> => {
      if (!account || !walletClient) {
        return {
          simError: {
            short: "Wallet not connected",
            full: "Connect a wallet before signing this action.",
          },
        };
      }
      if (!publicClient) {
        return {
          simError: {
            short: "RPC unavailable",
            full: "Public client not ready for this chain — try again in a moment.",
          },
        };
      }
      setSimulating(true);
      try {
        // Cast to `any` here: `simulateContract`'s return type is a
        // generic-heavy union that, when the abi/functionName aren't
        // known at compile time, blows up tsc with TS2590 ("union too
        // complex"). The runtime is fully validated by viem itself —
        // we only need the prepared `request` to forward.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sim = (await (publicClient as any).simulateContract({
          address: args.address,
          abi: args.abi,
          functionName: args.functionName,
          args: args.args,
          account,
          value: args.value,
        })) as { request: unknown };
        setSimulating(false);
        setSubmitting(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txHash = (await walletClient.writeContract(sim.request as any)) as Hex;
        return { txHash };
      } catch (err) {
        return { simError: prettifySimError(err) };
      } finally {
        setSimulating(false);
        setSubmitting(false);
      }
    },
    [account, publicClient, walletClient],
  );

  return { submit, simulating, submitting };
}
