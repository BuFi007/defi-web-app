"use client";

import { useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  useDynamicContext,
  useIsLoggedIn,
} from "@dynamic-labs/sdk-react-core";

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

    // 1. Dev wallet wins. We ALSO pre-mint the wallet-session proof
    //    synchronously — the dev wallet signs locally with no UI prompt,
    //    so it costs nothing to have the proof ready in the store from
    //    first paint. Production wallets DON'T do this — they sign only
    //    on explicit user action via useEnsureSession.
    if (devWallet) {
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
    //    and Dynamic created an embedded wallet that's not (yet) bridged
    //    into wagmi.
    //
    //    Gate on EITHER signal, not both. There's a window after social-
    //    auth where `useIsLoggedIn()` returns true but `primaryWallet` is
    //    still null while Dynamic provisions the embedded wallet. The old
    //    home/index.tsx gate used OR for exactly this reason — requiring
    //    both here regressed the social-auth flow (header pill renders the
    //    user's name, but the page is stuck on "Welcome / connect wallet"
    //    because status stays "anonymous").
    if (isDynamicLoggedIn || primaryWallet) {
      const addr = (primaryWallet?.address ?? null) as
        | `0x${string}`
        | null;
      const chainStr = primaryWallet?.connectedChain ?? null;
      const chainNum =
        chainStr && typeof chainStr === "string" && /^\d+$/.test(chainStr)
          ? Number(chainStr)
          : null;
      setIdentity({
        status: "connected",
        address: addr,
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
