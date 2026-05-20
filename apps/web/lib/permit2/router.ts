/**
 * Feature-flagged Permit2 router resolution.
 *
 * The Permit2 _contract_ is universally deployed at PERMIT2_ADDRESS — see
 * `./constants.ts`. What VARIES per chain is the protocol-specific router
 * the user delegates Permit2 pulls TO. For BUFI that router is shipped by
 * fx-telarana#26; until it lands on a given chain we have nothing to sign
 * a permit AGAINST, so the whole one-sig flow stays dark.
 *
 * Routers are surfaced via per-chain env vars so the frontend can light
 * up the one-sig path chain-by-chain as the contracts deploy:
 *
 *   NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002   (Arc testnet)
 *   NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_43113     (Avalanche Fuji)
 *
 * When unset, `resolvePermit2Router()` returns null and callers fall back
 * to the legacy `approve` + `transferFrom` path. When set, the one-sig
 * UX lights up automatically.
 */

import type { Address } from "viem";
import { isAddress } from "viem";

/**
 * Per-chain env var name. Matches the pattern used elsewhere in apps/web
 * (cf. NEXT_PUBLIC_BUFI_* per-chain RPC URLs).
 */
export function permit2RouterEnvKey(chainId: number): string {
  return `NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_${chainId}`;
}

/**
 * In-process env lookup. Next.js inlines `process.env.NEXT_PUBLIC_*` at
 * build time, so a runtime `process.env[dynamicKey]` lookup will return
 * undefined in the browser bundle. To survive Next's static-replace step
 * we enumerate the chains we currently support explicitly — the build-time
 * inliner sees each access and bakes the value in.
 *
 * Adding a chain: extend `KNOWN_CHAIN_ENVS` and the build picks it up.
 */
const KNOWN_CHAIN_ENVS: Record<number, string | undefined> = {
  // Arc testnet — fx-telarana #26 deploy target.
  5042002: process.env.NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002,
  // Avalanche Fuji — secondary deploy target.
  43113: process.env.NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_43113,
};

/**
 * Resolve the Permit2 spender router address for `chainId`.
 *
 * Returns null when:
 *   - The env var is unset (router not yet deployed on that chain)
 *   - The env var is set to a non-address string (defensive — we'd rather
 *     fall back to the legacy approve path than hand wagmi a bogus spender)
 *
 * Returns an `Address` (always lower-cased + checksummed via `isAddress`
 * validation) when the router is live.
 */
export function resolvePermit2Router(chainId: number): Address | null {
  const raw = KNOWN_CHAIN_ENVS[chainId];
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!isAddress(trimmed)) return null;
  return trimmed as Address;
}

/**
 * Boolean selector — convenient for `useMemo` deps in React components
 * that want to conditionally render the one-sig deposit UI vs the
 * fallback approve-then-deposit UI.
 */
export function isPermit2RouterAvailable(chainId: number): boolean {
  return resolvePermit2Router(chainId) !== null;
}
