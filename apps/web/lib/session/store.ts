"use client";

import { create } from "zustand";

import type { WalletSessionProof } from "@/lib/perps/replacement-agent";

/**
 * BufiSession is the single source of truth for "who is connected and how".
 *
 * Three legacy sources fed this question before:
 *   - wagmi.useAccount().isConnected        (extension wallets only)
 *   - Dynamic.useIsLoggedIn() / primaryWallet (social auth + extension)
 *   - getPerpsReplacementDevWallet() / getBentoDevWallet() (dev mocks)
 *
 * Every component that gated on "logged in" had to OR those three together,
 * and the dev shims diverged in caching strategy. The store collapses them
 * into one selectable atom.
 *
 * The SessionBridge component (lib/session/session-bridge.tsx) is the ONLY
 * thing that writes to this store. Consumers read via selectors.
 */
export type SessionStatus = "anonymous" | "connecting" | "connected";

export type SessionSource = "wagmi" | "dynamic-social" | "dev-mock";

export interface BufiSession {
  status: SessionStatus;
  address: `0x${string}` | null;
  chainId: number | null;
  source: SessionSource | null;
  /** Cached wallet-session typed-data proof. Lazy — only populated after
   *  the first useEnsureSession() call returns. Cleared on address/chain change. */
  proof: WalletSessionProof | null;
}

const initialState: BufiSession = {
  status: "anonymous",
  address: null,
  chainId: null,
  source: null,
  proof: null,
};

interface BufiSessionActions {
  /** Set by SessionBridge in response to wagmi/Dynamic events. Resets proof
   *  when address or chain changes. */
  setIdentity: (
    next: Pick<BufiSession, "status" | "address" | "chainId" | "source">,
  ) => void;
  /** Set by useEnsureSession() after a successful signature. */
  setProof: (proof: WalletSessionProof | null) => void;
  /** Hard reset (logout / disconnect). */
  reset: () => void;
}

export const useBufiSessionStore = create<BufiSession & BufiSessionActions>(
  (set, get) => ({
    ...initialState,
    setIdentity(next) {
      const prev = get();
      // Identity change → drop any cached proof. Forces a re-sign on the
      // first action that needs auth, instead of silently reusing a proof
      // signed by a previous wallet/chain.
      const identityChanged =
        prev.address?.toLowerCase() !== next.address?.toLowerCase() ||
        prev.chainId !== next.chainId;
      set({
        ...next,
        proof: identityChanged ? null : prev.proof,
      });
    },
    setProof(proof) {
      set({ proof });
    },
    reset() {
      set(initialState);
    },
  }),
);

// ---------- selectors (use these from components) ----------

export const selectStatus = (s: BufiSession) => s.status;
export const selectAddress = (s: BufiSession) => s.address;
export const selectChainId = (s: BufiSession) => s.chainId;
export const selectSource = (s: BufiSession) => s.source;
export const selectIsConnected = (s: BufiSession) => s.status === "connected";
export const selectIsDevMock = (s: BufiSession) => s.source === "dev-mock";
export const selectProof = (s: BufiSession) => s.proof;
