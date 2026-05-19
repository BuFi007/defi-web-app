/**
 * localStorage cache for `WalletSessionProof`. Pure browser API, no
 * React. Three signing surfaces share this cache so a session signed
 * via the perps replacement-agent button is reused by the next
 * useEnsureSession() call and vice versa.
 *
 * Key shape: `bufx.wallet-session:<chainId>:<address>` (lowercase).
 * MUST stay byte-identical to the legacy key in apps/web/lib/perps/
 * replacement-agent.ts -- changing the format would invalidate every
 * user's currently-cached session and force a re-sign on next action,
 * which is exactly the MM-popup regression we just eliminated.
 *
 * Read returns null when:
 *   - localStorage unavailable (SSR + Safari private)
 *   - no entry for the key
 *   - JSON parse fails (corrupt entry)
 *   - the address or chainId in the cached entry doesn't match (paranoia)
 *   - the cached entry will expire within SESSION_REFRESH_SKEW_SECONDS
 */

import type { Hex } from "viem";

import {
  SESSION_REFRESH_SKEW_SECONDS,
  type WalletSessionProof,
} from "./types";
import {
  fromJsonSafeTypedData,
  toJsonSafeTypedData,
  type JsonSafeTypedData,
} from "./build";

interface CachedWalletSession {
  address: string;
  chainId: number;
  message: string;
  signature: Hex;
  iat: number;
  exp: number;
  typedData?: JsonSafeTypedData;
}

function walletSessionKey(address: string, chainId: number): string {
  return `bufx.wallet-session:${chainId}:${address.toLowerCase()}`;
}

export function readCachedWalletSession(
  address: string,
  chainId: number,
): WalletSessionProof | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(walletSessionKey(address, chainId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedWalletSession;
    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp <= now + SESSION_REFRESH_SKEW_SECONDS) return null;
    if (parsed.address.toLowerCase() !== address.toLowerCase()) return null;
    if (parsed.chainId !== chainId) return null;
    return {
      address: parsed.address,
      chainId: parsed.chainId,
      message: parsed.message,
      signature: parsed.signature,
      iat: parsed.iat,
      exp: parsed.exp,
      typedData: parsed.typedData
        ? fromJsonSafeTypedData(parsed.typedData)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function writeCachedWalletSession(proof: WalletSessionProof): void {
  if (typeof window === "undefined") return;
  const serializable: CachedWalletSession = {
    address: proof.address,
    chainId: proof.chainId,
    message: proof.message,
    signature: proof.signature,
    iat: proof.iat,
    exp: proof.exp,
    typedData: proof.typedData
      ? toJsonSafeTypedData(proof.typedData)
      : undefined,
  };
  window.localStorage.setItem(
    walletSessionKey(proof.address, proof.chainId),
    JSON.stringify(serializable),
  );
}

/** Drop the cached session — exposed so a "Sign out" UX path can purge
 *  the proof without writing a placeholder. */
export function clearCachedWalletSession(address: string, chainId: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(walletSessionKey(address, chainId));
}
