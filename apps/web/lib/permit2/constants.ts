/**
 * Canonical Uniswap Permit2 constants.
 *
 * Permit2 is deployed at the SAME address on every chain Uniswap supports
 * (and most others, via vanity-address deploy):
 *
 *   0x000000000022D473030F116dDEE9F6B43aC78BA3
 *
 * Source: https://docs.uniswap.org/contracts/permit2/overview
 * Contract: https://github.com/Uniswap/permit2
 *
 * Because the address is identical cross-chain, we do NOT need a per-chain
 * lookup — the EIP-712 `verifyingContract` field is always this constant.
 * What DOES vary per chain is the downstream router (the `spender` in the
 * permit), which we resolve via env in `./router.ts`.
 */

import type { Address } from "viem";

/** Permit2 contract address — same on every EVM chain. */
export const PERMIT2_ADDRESS: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * EIP-712 domain name — the Permit2 contract returns this from
 * `DOMAIN_SEPARATOR()` and uses it to construct the typed-data hash.
 * Verbatim from the contract: `string private constant _NAME = "Permit2";`.
 *
 * Note: Permit2 does NOT include a `version` field in its domain (unlike
 * EIP-2612 permit which does), so callers must build the domain with
 * `{ name, chainId, verifyingContract }` only.
 */
export const PERMIT2_DOMAIN_NAME = "Permit2" as const;

/**
 * Default permit windows, matching the soft conventions Uniswap's own
 * frontend uses. Callers can override per call site.
 *
 *   - allowanceExpiration: how long the Permit2 allowance lives once the
 *     router calls `permit()`. After this, the router can no longer pull
 *     funds without a fresh signature. 30 days is the Uniswap-recommended
 *     default for swap routers; we mirror it for the perps deposit router.
 *
 *   - sigDeadline: how long the signature itself is valid. Short — once
 *     the user signs we expect to submit immediately. 30 minutes is the
 *     Uniswap default; long enough to survive a slow MetaMask round-trip,
 *     short enough that a stolen sig doesn't sit around exploitable.
 */
export const ALLOWANCE_EXPIRATION_DEFAULTS = {
  /** Seconds. 30 days. */
  allowanceExpirationSec: 60 * 60 * 24 * 30,
  /** Seconds. 30 minutes. */
  sigDeadlineSec: 60 * 30,
} as const;

/**
 * Permit2 stores nonces as a 256-bit bitmap per (owner, wordPos) pair.
 * Each word holds 256 single-use nonce bits. To find a fresh nonce we
 * read `nonceBitmap(owner, wordPos)` and scan for the lowest unset bit.
 *
 * The final on-chain nonce is computed as:
 *
 *   nonce = (wordPos << 8) | bitPos
 *
 * For typical users wordPos=0 covers the first 256 permits, which is more
 * than enough for any realistic deposit cadence.
 */
export const PERMIT2_NONCE_BITS_PER_WORD = 256n;
