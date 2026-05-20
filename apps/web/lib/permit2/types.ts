/**
 * TypeScript shapes for the two Uniswap Permit2 typed-data flavours.
 *
 * Permit2 exposes two distinct signing flows:
 *
 *   1. AllowanceTransfer — `PermitSingle` / `PermitBatch`. Long-lived
 *      allowance the user grants to a spender. After the router calls
 *      `permit()` ONCE, it can `transferFrom()` repeatedly until expiry.
 *      This is the right shape for "approve once, trade many times".
 *
 *   2. SignatureTransfer — `PermitTransferFrom` / `PermitBatchTransferFrom`.
 *      Single-use signature; each transfer needs its own fresh signature
 *      against a fresh nonce. The signature itself authorises ONE pull.
 *      This is the right shape for "one-sig deposit" where each deposit
 *      is a discrete, audited pull from EOA into the protocol.
 *
 * The perps deposit router (fx-telarana#26) is expected to use
 * SignatureTransfer (PermitTransferFrom) — one signature per deposit
 * keeps the audit trail tight and avoids the long-lived approval surface.
 * We model BOTH shapes here so we're ready either way.
 *
 * The numeric fields are bigint at this layer (precise) and serialize as
 * lowercase 0x-hex / decimal string in the eth_signTypedData_v4 payload —
 * wagmi/viem handle that conversion for us.
 */

import type { Address } from "viem";

// ---------------------------------------------------------------------------
// AllowanceTransfer (PermitSingle)
// ---------------------------------------------------------------------------

/** The `details` sub-struct of a PermitSingle. Mirrors the on-chain struct. */
export interface PermitDetails {
  token: Address;
  /** uint160. Max permitted pull per call. */
  amount: bigint;
  /** uint48. Unix seconds; allowance dies after this. */
  expiration: number;
  /** uint48. Permit2 enforces strict monotonic-per-token nonces here. */
  nonce: number;
}

export interface PermitSingleMessage {
  details: PermitDetails;
  spender: Address;
  /** uint256. Unix seconds; signature is rejected after this. */
  sigDeadline: bigint;
}

export interface PermitSingleArgs {
  chainId: number;
  owner: Address;
  token: Address;
  amount: bigint;
  /** Unix seconds. */
  expiration: number;
  /** Per-token monotonic nonce. */
  nonce: number;
  /** Unix seconds. */
  sigDeadline: bigint;
  /**
   * Optional spender override. When omitted, callers should resolve it
   * via `resolvePermit2Router(chainId)` — the hook does that automatically.
   */
  spender?: Address;
}

// ---------------------------------------------------------------------------
// SignatureTransfer (PermitTransferFrom)
// ---------------------------------------------------------------------------

/** The `permitted` sub-struct of a PermitTransferFrom. */
export interface TokenPermissions {
  token: Address;
  /** uint256. Max amount transferable under this signature. */
  amount: bigint;
}

export interface PermitTransferFromMessage {
  permitted: TokenPermissions;
  spender: Address;
  /**
   * uint256. Permit2 SignatureTransfer uses a BITMAP nonce model — see
   * `next-nonce.ts`. Each nonce can only be consumed once across the
   * owner's lifetime. The mapping is `(wordPos << 8) | bitPos`.
   */
  nonce: bigint;
  /** uint256. Unix seconds. */
  deadline: bigint;
}

export interface PermitTransferFromArgs {
  chainId: number;
  owner: Address;
  token: Address;
  amount: bigint;
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
  spender?: Address;
}

// ---------------------------------------------------------------------------
// Signed envelopes — what the hook hands back to call sites.
// ---------------------------------------------------------------------------

/** Result of `signPermitSingle()` — pass straight to the router. */
export interface SignedPermitSingle {
  permit: PermitSingleMessage;
  signature: `0x${string}`;
  /** Chain the signature is bound to. */
  chainId: number;
  /** The spender baked into the signed message — usually the router address. */
  spender: Address;
}

/** Result of `signPermitTransferFrom()` — pass straight to the router. */
export interface SignedPermitTransferFrom {
  permit: PermitTransferFromMessage;
  signature: `0x${string}`;
  chainId: number;
  spender: Address;
}

// ---------------------------------------------------------------------------
// EIP-712 type tables, exported so the hook + downstream encoders share
// one source. Order MUST match the on-chain hash order or `verify` fails.
// ---------------------------------------------------------------------------

export const PERMIT_DETAILS_TYPE = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint160" },
  { name: "expiration", type: "uint48" },
  { name: "nonce", type: "uint48" },
] as const;

export const PERMIT_SINGLE_TYPE = [
  { name: "details", type: "PermitDetails" },
  { name: "spender", type: "address" },
  { name: "sigDeadline", type: "uint256" },
] as const;

export const TOKEN_PERMISSIONS_TYPE = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

export const PERMIT_TRANSFER_FROM_TYPE = [
  { name: "permitted", type: "TokenPermissions" },
  { name: "spender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;
