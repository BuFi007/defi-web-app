"use client";

import { useCallback } from "react";
import type { Hex } from "viem";
import { useSignTypedData } from "wagmi";

import {
  buildWalletSessionTypedData,
  readCachedWalletSession,
  walletSessionHeaders,
  writeCachedWalletSession,
  type WalletSessionHeaders,
  type WalletSessionProof,
} from "@/lib/perps/replacement-agent";

import { useDevWallet } from "@/lib/dev-wallet";
import { useBufiSessionStore } from "./store";

/**
 * The ONE way to mint or retrieve a wallet-session signature.
 *
 * Why this exists:
 *   - The old code called `useSignTypedData()` from 8+ places. Each had its
 *     own caching strategy. A background poll (PerpsReplacementAgent's 8s
 *     interval) competed with user-initiated signs and triggered the
 *     EIP-1193 4100 spam loop on fresh MetaMask connects.
 *   - This hook collapses all of them. The returned `ensure(purpose)` is
 *     a stable callback meant to be called FROM A USER EVENT HANDLER. It:
 *       1. Checks the Zustand store — return cached proof if fresh.
 *       2. Checks localStorage — return cached proof if fresh.
 *       3. Builds the typed-data, signs it (dev wallet OR wagmi), stores it.
 *
 * Critically: there is NO useEffect that auto-signs on mount or on
 * connection change. The signing only happens when `ensure()` is called.
 *
 * @example
 *   const { ensure, isSigning } = useEnsureSession();
 *   const handleClick = async () => {
 *     const proof = await ensure("perps.replacement");
 *     await fetch("/api/perps/...", { headers: walletSessionHeaders(proof) });
 *   };
 */
export function useEnsureSession(): {
  ensure: (purpose: string) => Promise<WalletSessionProof>;
  ensureHeaders: (purpose: string) => Promise<WalletSessionHeaders>;
  isSigning: boolean;
} {
  const devWallet = useDevWallet();
  const { signTypedDataAsync, isPending } = useSignTypedData();

  const ensure = useCallback(
    async (_purpose: string): Promise<WalletSessionProof> => {
      // Snapshot the store at call time. Reading from outside React's
      // render path is safe with Zustand's getState().
      const { address, chainId, proof } = useBufiSessionStore.getState();
      if (!address || !chainId) {
        throw new Error(
          "useEnsureSession.ensure() called before a wallet is connected",
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const skew = 60;
      if (proof && proof.address.toLowerCase() === address.toLowerCase() && proof.chainId === chainId && proof.exp - skew > now) {
        return proof;
      }

      // Fall back to localStorage (survives reloads).
      const cached = readCachedWalletSession(address, chainId);
      if (cached) {
        useBufiSessionStore.getState().setProof(cached);
        return cached;
      }

      // Mint a new one. Sign via dev wallet if active, otherwise wagmi.
      const built = buildWalletSessionTypedData({ address, chainId });
      const signature: Hex = devWallet
        ? await devWallet.signSessionTypedData(built.typedData)
        : ((await signTypedDataAsync({
            domain: built.typedData.domain,
            types: built.typedData.types,
            primaryType: built.typedData.primaryType,
            message: built.typedData.message,
          })) as Hex);

      const fresh: WalletSessionProof = {
        address,
        chainId,
        message: built.message,
        signature,
        iat: built.iat,
        exp: built.exp,
        typedData: built.typedData,
      };

      writeCachedWalletSession(fresh);
      useBufiSessionStore.getState().setProof(fresh);
      return fresh;
    },
    [devWallet, signTypedDataAsync],
  );

  const ensureHeaders = useCallback(
    async (purpose: string): Promise<WalletSessionHeaders> => {
      const proof = await ensure(purpose);
      return walletSessionHeaders(proof);
    },
    [ensure],
  );

  return { ensure, ensureHeaders, isSigning: isPending };
}
