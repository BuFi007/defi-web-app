/**
 * Pimlico bundler + paymaster wiring for the ZeroDev session-key UserOp
 * submission path.
 *
 * Wave F4 (PR #55 stack). PR #55 ships everything up to "session key is
 * minted, encrypted, and the kernel account is hydrated in memory" — but
 * stops short of actually submitting UserOps because Arc Testnet doesn't
 * have a ZeroDev project ID provisioned. This module fills that gap by
 * routing UserOps through Pimlico's chain-agnostic bundler.
 *
 *   EOA (one popup, owner approval)
 *      │
 *      ▼
 *   ZeroDev kernel (`session-key-policies.ts`)
 *      │ session key signs each UserOp
 *      ▼
 *   `buildKernelClient(...)`  ◀── you are here
 *      │  bundlerTransport → Pimlico bundler RPC
 *      │  paymaster         → Pimlico paymaster RPC (ERC-7677) — optional
 *      ▼
 *   On-chain settleMatch / cancelOrder / depositMargin / withdrawMargin
 *
 * Why Pimlico (and not `createZeroDevPaymasterClient`):
 *   ZeroDev's paymaster RPC needs a ZeroDev project ID provisioned per
 *   (chain, app). Arc Testnet doesn't have one yet. Pimlico speaks the
 *   ERC-7677 paymaster RPC schema (`pm_getPaymasterStubData` /
 *   `pm_getPaymasterData`), which viem's `createPaymasterClient` and the
 *   ZeroDev kernel client both consume natively. So the kernel signing
 *   stays ZeroDev; the rails (bundler + paymaster) are Pimlico.
 *
 * Falling back without a paymaster:
 *   If `NEXT_PUBLIC_PIMLICO_PAYMASTER_URL` is not configured, the kernel
 *   client is built without a paymaster. The user op is then paid for in
 *   the kernel's native gas token (USDC on Arc — perfect for testnet
 *   demos). The bundler URL alone is enough to submit UserOps.
 *
 * Failure modes:
 *   - No bundler URL → `buildKernelClient` THROWS. The caller (the
 *     `useFastPerpWrite` composer) catches and falls back to the EOA
 *     `useSimulatedWrite` flow. No silent failure, no swallowed errors.
 *   - Bundler reachable but UserOp rejected (bad policy, kernel not
 *     deployed, etc) → throws at `client.sendTransaction(...)` time;
 *     same fallback path applies.
 *   - Paymaster unreachable but bundler ok → UserOp still submits, user
 *     pays USDC gas. Acceptable degraded mode.
 */

import {
  createKernelAccountClient,
  type KernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint } from "@zerodev/sdk/constants";
import {
  http,
  type Chain,
  type Transport,
} from "viem";
import {
  createPaymasterClient,
  type SmartAccount,
} from "viem/account-abstraction";
import { arcTestnet, avalancheFuji } from "viem/chains";

const ENTRY_POINT = getEntryPoint("0.7");

/** Env var name for the Pimlico bundler RPC URL template. */
export const ENV_BUNDLER_URL = "NEXT_PUBLIC_PIMLICO_BUNDLER_URL";
/** Env var name for the Pimlico paymaster RPC URL template. */
export const ENV_PAYMASTER_URL = "NEXT_PUBLIC_PIMLICO_PAYMASTER_URL";
/** Env var name for the optional Pimlico sponsorship policy id. */
export const ENV_SPONSORSHIP_POLICY_ID = "NEXT_PUBLIC_PIMLICO_SPONSORSHIP_POLICY_ID";

/** Token Pimlico's docs use to template chain id into the bundler URL. */
const CHAIN_ID_TOKEN = "{CHAIN_ID}";

export interface BuildKernelClientArgs {
  /**
   * The hydrated kernel smart account from `useSessionKey().kernelAccount`.
   * Must already have the session-key permission validator installed.
   */
  kernel: SmartAccount;
  /** Chain id the kernel was created for. Used to template the Pimlico URL. */
  chainId: number;
}

export interface ResolvedPimlicoEndpoints {
  bundlerUrl: string;
  paymasterUrl: string | null;
  sponsorshipPolicyId: string | null;
}

/**
 * Read-only env resolver. Pulled out of `buildKernelClient` so tests +
 * the `useFastPerpWrite` composer can probe "is Pimlico configured?"
 * without instantiating a client.
 *
 * Returns `null` when the bundler URL is missing — that's the canonical
 * "session keys are disabled at the infra layer" signal.
 */
export function resolvePimlicoEndpoints(chainId: number): ResolvedPimlicoEndpoints | null {
  const rawBundler = process.env[ENV_BUNDLER_URL];
  if (!rawBundler) return null;
  const bundlerUrl = rawBundler.replace(CHAIN_ID_TOKEN, String(chainId));
  const rawPaymaster = process.env[ENV_PAYMASTER_URL];
  const paymasterUrl = rawPaymaster
    ? rawPaymaster.replace(CHAIN_ID_TOKEN, String(chainId))
    : null;
  const sponsorshipPolicyId = process.env[ENV_SPONSORSHIP_POLICY_ID] || null;
  return { bundlerUrl, paymasterUrl, sponsorshipPolicyId };
}

/**
 * Cheap predicate the composer hook can call without throwing. Returns
 * true iff a bundler URL is configured for the given chain id; the
 * paymaster URL is optional (we degrade to USDC-paid gas without it).
 */
export function isPimlicoConfigured(chainId: number): boolean {
  return resolvePimlicoEndpoints(chainId) !== null;
}

/**
 * Map chainId → viem Chain object. The kernel client needs the Chain
 * for the JSON-RPC `eth_chainId` handshake; passing the wrong one
 * silently produces UserOps with mismatched signatures.
 *
 * Today: Arc Testnet (the perps deployment chain) + Fuji (the EVM hub
 * for crypto perps). Extending to a new hub means adding one branch
 * here — every other surface keys off `@bufi/location/hubs`, but
 * `viem/chains` is the load-bearing dependency for AA.
 */
function chainFor(chainId: number): Chain {
  if (chainId === arcTestnet.id) return arcTestnet;
  if (chainId === avalancheFuji.id) return avalancheFuji;
  throw new Error(
    `pimlico-client: no viem Chain registered for chainId=${chainId}; ` +
      `add a branch in chainFor() to enable the session-key bundler on this hub`,
  );
}

/**
 * Build a ZeroDev KernelAccountClient pointed at Pimlico. The returned
 * client exposes `sendTransaction({ to, data, value })` (UserOp under
 * the hood) plus the rest of the viem smart-account client surface.
 *
 * THROWS if `NEXT_PUBLIC_PIMLICO_BUNDLER_URL` is unset. Callers should
 * catch and fall back to the EOA path — there's no implicit fallback
 * inside this function, by design (a quiet fallback would hide a
 * misconfiguration in production where session keys are meant to be
 * the primary path).
 */
export function buildKernelClient({
  kernel,
  chainId,
}: BuildKernelClientArgs): KernelAccountClient<
  Transport,
  Chain,
  SmartAccount
> {
  const endpoints = resolvePimlicoEndpoints(chainId);
  if (!endpoints) {
    throw new Error(
      `pimlico-client: ${ENV_BUNDLER_URL} is not configured for chainId=${chainId}; ` +
        `session keys cannot submit UserOps — caller should fall back to EOA`,
    );
  }

  const chain = chainFor(chainId);
  const bundlerTransport = http(endpoints.bundlerUrl);

  // Paymaster wiring. We use viem's vanilla `createPaymasterClient`
  // (ERC-7677) instead of ZeroDev's `createZeroDevPaymasterClient`
  // because the latter expects a ZeroDev RPC URL — Pimlico exposes the
  // standard ERC-7677 schema directly.
  const paymaster = endpoints.paymasterUrl
    ? createPaymasterClient({
        transport: http(endpoints.paymasterUrl),
      })
    : undefined;

  // Sponsorship policy is passed via Pimlico's paymasterContext shape
  // (per their docs: { sponsorshipPolicyId: "..." }). Omitted when the
  // env var is unset; the paymaster falls back to default policy
  // matching on the API key.
  const paymasterContext = endpoints.sponsorshipPolicyId
    ? { sponsorshipPolicyId: endpoints.sponsorshipPolicyId }
    : undefined;

  return createKernelAccountClient({
    account: kernel,
    chain,
    bundlerTransport,
    paymaster,
    paymasterContext,
    // The viem account-abstraction client wants the entry point on the
    // bundler config, not the account, when targeting a non-ZeroDev
    // bundler. We omit it explicitly: the kernel account carries its
    // own entry point (0.7) and the bundler honors what the account
    // declares.
  }) as KernelAccountClient<Transport, Chain, SmartAccount>;
}

export { ENTRY_POINT };
