"use client";

import { useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
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
  // userWallets is ALL wallets the Dynamic account has linked (extension
  // + embedded + WalletConnect). primaryWallet picks one — but during
  // social-auth bootstrap or when the user has multiple linked extensions
  // without an explicit "set primary" choice, primaryWallet can be null
  // even though there ARE usable wallet addresses in the account.
  const userWallets = useUserWallets();

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
      // Address resolution order:
      //   1. primaryWallet — Dynamic's actively-selected wallet
      //   2. wagmiAddress — set when DynamicWagmiConnector has bridged
      //   3. userWallets[0] — first linked wallet on the account
      //
      // Without (3), users who logged in via social-auth + linked an
      // existing wallet (no primary selected yet) saw the arcade gate
      // fire "Connect a wallet" even though their address was visible
      // in the header. (3) makes the gate trust any linked wallet so
      // downstream actions can target it.
      const firstLinked = userWallets[0]?.address as
        | `0x${string}`
        | undefined;
      const addr =
        ((primaryWallet?.address as `0x${string}` | undefined) ??
          (wagmiAddress as `0x${string}` | undefined) ??
          firstLinked ??
          null) as `0x${string}` | null;
      // Dynamic's Wallet shape doesn't carry connectedChain as a
      // documented field anymore — fall back to wagmi's chainId which
      // tracks the connector's active chain. This is the same value
      // useChainId() would return; we resolve it here so the store
      // stays in sync with the active wallet.
      const chainNum = wagmiChainId ?? null;
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
    userWallets,
  ]);

  return null;
}
