"use client";

import { useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  useDynamicContext,
  useIsLoggedIn,
} from "@dynamic-labs/sdk-react-core";

import { useDevWallet } from "@/lib/dev-wallet";
import { useBufiSessionStore } from "./store";

/**
 * The ONE place that writes identity into the BufiSession store.
 *
 * Read order (precedence):
 *   1. Dev wallet (NEXT_PUBLIC_*_E2E flags) — preempts everything else.
 *   2. wagmi useAccount() — extension wallet path (MetaMask, etc.) AND
 *      Dynamic's social-auth embedded wallets ARE bridged here once
 *      DynamicWagmiConnector wires them in.
 *   3. Dynamic useIsLoggedIn() — fallback for social-auth where the
 *      embedded wallet isn't bridged yet (Gmail login on a fresh tab).
 *
 * This is the ONLY useEffect that touches connection state. No signing
 * happens here. Signing happens in useEnsureSession(), triggered by user
 * actions.
 */
export function SessionBridge() {
  const devWallet = useDevWallet();
  const { address: wagmiAddress, status: wagmiStatus } = useAccount();
  const wagmiChainId = useChainId();
  const isDynamicLoggedIn = useIsLoggedIn();
  const { primaryWallet } = useDynamicContext();

  useEffect(() => {
    const setIdentity = useBufiSessionStore.getState().setIdentity;

    // 1. Dev wallet wins.
    if (devWallet) {
      setIdentity({
        status: "connected",
        address: devWallet.address,
        chainId: devWallet.chainId,
        source: "dev-mock",
      });
      return;
    }

    // 2. wagmi happy path — extension wallet OR Dynamic embedded wallet
    //    that has been bridged into the wagmi config.
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

    // 3. Dynamic social-auth fallback — when the user logged in via Gmail
    //    and Dynamic created an embedded wallet that's not (yet) in wagmi.
    if (isDynamicLoggedIn && primaryWallet) {
      const addr = primaryWallet.address as `0x${string}` | undefined;
      const chainStr = primaryWallet.connectedChain ?? null;
      const chainNum =
        chainStr && typeof chainStr === "string" && /^\d+$/.test(chainStr)
          ? Number(chainStr)
          : null;
      setIdentity({
        status: "connected",
        address: addr ?? null,
        chainId: chainNum,
        source: "dynamic-social",
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
    wagmiAddress,
    wagmiStatus,
    wagmiChainId,
    isDynamicLoggedIn,
    primaryWallet,
  ]);

  return null;
}
