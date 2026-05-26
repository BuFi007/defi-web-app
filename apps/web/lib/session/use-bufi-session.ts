"use client";

import {
  selectAddress,
  selectChainId,
  selectIsConnected,
  selectIsDevMock,
  selectProof,
  selectSource,
  selectStatus,
  useBufiSessionStore,
  type BufiSession,
} from "./store";

/**
 * Canonical hook for "who is signed in and how".
 *
 * Replaces every direct call to `useAccount().isConnected`,
 * `getPerpsReplacementDevWallet()`, and `getBentoDevWallet()` in app code.
 *
 * The store is updated by SessionBridge in response to wagmi
 * events — components subscribe via selectors so React only re-renders
 * when the field they care about actually changes (Zustand's default
 * shallow-equality subscription).
 */
export function useBufiSession(): BufiSession {
  return useBufiSessionStore();
}

// Narrow selector hooks for the common cases. Prefer these over
// useBufiSession() because they re-render only when the selected slice
// changes — useBufiSession() re-renders on ANY store change.

export function useBufiAddress(): `0x${string}` | null {
  return useBufiSessionStore(selectAddress);
}

export function useBufiChainId(): number | null {
  return useBufiSessionStore(selectChainId);
}

export function useBufiSessionStatus() {
  return useBufiSessionStore(selectStatus);
}

export function useBufiIsConnected(): boolean {
  return useBufiSessionStore(selectIsConnected);
}

export function useBufiSource() {
  return useBufiSessionStore(selectSource);
}

export function useBufiIsDevMock(): boolean {
  return useBufiSessionStore(selectIsDevMock);
}

export function useBufiSessionProof() {
  return useBufiSessionStore(selectProof);
}
