import type { Hex } from "viem";

/**
 * Canonical wallet-session shapes.
 *
 * Lives in @bufi/wallet so every signing surface (useEnsureSession,
 * useSessionSigner in perps/hooks, ensureSession in telarana/hooks)
 * speaks the SAME proof type. The previous repo had three near-identical
 * copies; they're collapsed here.
 *
 * `WalletSessionProof` is what gets cached + sent to the API. The
 * optional `typedData` field carries the EIP-712 payload that produced
 * the signature so the backend can verify it without re-deriving the
 * struct.
 */

/** Hours the cached session stays valid. Match the backend's expiry
 *  window in apps/api/src/wallet-session.ts. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

/** Refresh skew — sessions within this window of expiring are
 *  considered already-stale and the cache reader returns null. */
export const SESSION_REFRESH_SKEW_SECONDS = 60;

export const SESSION_TTL_HOURS = SESSION_TTL_SECONDS / 3600;

export interface WalletSessionTypedData {
  domain: {
    name: "BUFX Perps";
    version: "1";
    chainId: number;
  };
  types: {
    WalletSession: Array<{ name: string; type: string }>;
  };
  primaryType: "WalletSession";
  message: {
    purpose: string;
    wallet: `0x${string}`;
    chainId: bigint;
    origin: string;
    iat: bigint;
    exp: bigint;
  };
}

export interface WalletSessionProof {
  address: string;
  chainId: number;
  message: string;
  signature: Hex;
  iat: number;
  exp: number;
  /** Present when the user signed an EIP-712 typed-data session. */
  typedData?: WalletSessionTypedData;
}

export type WalletSessionHeaders = Record<string, string>;
