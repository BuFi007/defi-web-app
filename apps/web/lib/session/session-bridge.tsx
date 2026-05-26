"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useChainId } from "wagmi";

import { useDevWallet } from "@/lib/dev-wallet";
import {
  buildWalletSessionTypedData,
  writeCachedWalletSession,
  type WalletSessionProof,
} from "@/lib/perps/replacement-agent";
import { useBufiSessionStore } from "./store";

/**
 * The ONE place that writes identity into the BufiSession store.
 *
 * Read order (precedence):
 *   1. Dev wallet (NEXT_PUBLIC_*_E2E flags) -- preempts everything else.
 *   2. wagmi useAccount() -- extension wallet path (MetaMask, etc.) AND
 *      ConnectKit wallets.
 *
 * This is the ONLY useEffect that touches connection state. No signing
 * happens here. Signing happens in useEnsureSession(), triggered by user
 * actions.
 */
export function SessionBridge() {
  const devWallet = useDevWallet();
  const searchParams = useSearchParams();
  const devWalletActive =
    devWallet !== null && searchParams?.get("force-island") === "1";
  const { address: wagmiAddress, status: wagmiStatus, isConnected } = useAccount();
  const wagmiChainId = useChainId();

  useEffect(() => {
    const setIdentity = useBufiSessionStore.getState().setIdentity;

    // 1. Dev wallet wins -- but ONLY when the tab is in force-island
    //    mode (?force-island=1).
    if (devWalletActive && devWallet) {
      setIdentity({
        status: "connected",
        address: devWallet.address,
        chainId: devWallet.chainId,
        source: "dev-mock",
      });
      const built = buildWalletSessionTypedData({
        address: devWallet.address,
        chainId: devWallet.chainId,
      });
      devWallet
        .signSessionTypedData(built.typedData)
        .then((signature) => {
          const proof: WalletSessionProof = {
            address: devWallet.address,
            chainId: devWallet.chainId,
            message: built.message,
            signature,
            iat: built.iat,
            exp: built.exp,
            typedData: built.typedData,
          };
          writeCachedWalletSession(proof);
          useBufiSessionStore.getState().setProof(proof);
        })
        .catch(() => {
          // signing a local key shouldn't fail; if it does, leave proof
          // empty and useEnsureSession will retry on first call.
        });
      return;
    }

    // 2. wagmi path -- ConnectKit + extension wallets.
    if (wagmiStatus === "connected" && wagmiAddress) {
      setIdentity({
        status: "connected",
        address: wagmiAddress,
        chainId: wagmiChainId ?? null,
        source: "wagmi",
      });
      return;
    }
    if (wagmiStatus === "connecting" || wagmiStatus === "reconnecting") {
      setIdentity({
        status: "connecting",
        address: null,
        chainId: null,
        source: "wagmi",
      });
      return;
    }

    // Fully signed out.
    setIdentity({
      status: "anonymous",
      address: null,
      chainId: null,
      source: null,
    });
  }, [
    devWallet,
    devWalletActive,
    wagmiAddress,
    wagmiStatus,
    wagmiChainId,
    isConnected,
  ]);

  return null;
}
