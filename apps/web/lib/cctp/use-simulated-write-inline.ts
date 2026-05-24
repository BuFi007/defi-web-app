/**
 * Inline simulate-then-write helper for CCTP onramp writes.
 *
 * Mirrors the pattern from PR #44's `useSimulatedWrite` (a parallel
 * Wave G branch that doesn't yet exist in our base — see PR body for
 * the merge note). Wraps every on-chain write with `simulateContract`
 * first so revert reasons surface in the sheet BEFORE the wallet
 * popup ever opens.
 *
 * Why inline: this hook is small (≈40 lines real logic) and copying
 * it keeps the onramp branch self-contained. When PR #44 lands we can
 * drop this file and re-import the canonical `@/lib/web3/use-simulated-write`.
 *
 * Public surface kept symmetric with PR #44's hook so the swap is a
 * one-line import change:
 *   - `SimError` shape
 *   - `prettifySimError(unknown)` helper
 *   - `simulateThenWrite({ publicClient, walletClient, account, call })`
 */

import type {
  Abi,
  Address,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";

export interface SimulatedWriteArgs {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  account?: Address;
}

export interface SimError {
  /** One-line summary — fits in a toast title or inline error band. */
  short: string;
  /** Multiline detail — joined `metaMessages` when viem provides them. */
  full: string;
  /** Decoded custom-error name if viem could parse it (e.g. `InsufficientAllowance`). */
  reason?: string;
}

export interface SimulatedWriteResult {
  txHash?: Hex;
  simError?: SimError;
}

/**
 * Convert any viem revert/sim error into a UI-friendly shape.
 *
 * viem's `ContractFunctionExecutionError` carries `shortMessage`,
 * `metaMessages`, and (when the revert decodes to a known custom
 * error) `cause.data.errorName`. We defensively `any`-cast because
 * viem's error hierarchy is wide and we don't want a stale typecheck
 * to drop the decoded reason on the floor.
 */
export function prettifySimError(err: unknown): SimError {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const short: string =
    e?.shortMessage ?? e?.message ?? "Transaction would revert (no message)";
  const metas: string[] = Array.isArray(e?.metaMessages) ? e.metaMessages : [];
  const full = metas.length > 0 ? metas.join("\n") : short;
  const reason: string | undefined =
    e?.cause?.data?.errorName ?? e?.data?.errorName ?? e?.cause?.reason ?? undefined;
  return { short, full, reason };
}

/**
 * Simulate, then write. Throws on simulation failure (caller wraps in
 * try/catch and runs the result through `prettifySimError`). Returns
 * the tx hash from the wallet on success.
 */
export async function simulateThenWrite(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  call: SimulatedWriteArgs;
  chain?: WalletClient["chain"];
}): Promise<Hex> {
  const { publicClient, walletClient, account, call, chain } = params;
  // simulateContract reverts here BEFORE we ever ask the user to sign.
  // Cast to `any` to escape the generic-heavy return-type union; runtime
  // is fully validated by viem. (Same pattern as PR #44.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim = (await (publicClient as any).simulateContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    account,
    value: call.value,
  })) as { request: unknown };
  // The wallet client we use is per-chain, but `writeContract` still
  // wants the chain set explicitly when the request crosses a chain
  // boundary (e.g. switching between Fuji and Arc in the same flow).
  const request =
    chain != null
      ? { ...(sim.request as Record<string, unknown>), chain }
      : sim.request;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await walletClient.writeContract(request as any)) as Hex;
}
