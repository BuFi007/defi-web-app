"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useDynamicContext, useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import { NotConnectedHome } from "@/components/not-connected";
import TradeIsland from "@/components/trade-island";
import "@/css/trade-island/index.css";

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount();
  // Dynamic social-auth (Gmail / GitHub / email) creates an embedded wallet
  // that ISN'T auto-bridged to wagmi — `useAccount().isConnected` stays
  // false even though the user is fully authenticated. We need a separate
  // gate based on Dynamic's own session state, otherwise users who log in
  // via Gmail see "Welcome / Please connect your wallet" forever even
  // though their name appears in the header.
  const isDynamicLoggedIn = useIsLoggedIn();
  const { primaryWallet } = useDynamicContext();
  const isConnectedAnyPath =
    isConnected || isDynamicLoggedIn || Boolean(primaryWallet);
  const searchParams = useSearchParams();

  // BENTO_E2E force-island bypass.
  //
  // The Playwright e2e suite drives the Arcade / Loan / Perps UI through the
  // deterministic mock wallet shim in lib/bento/dev-mock-wallet.ts (gated on
  // NEXT_PUBLIC_BENTO_E2E=1). That shim only provides a Bento dev wallet —
  // it does NOT establish a wagmi connection, so without this bypass the
  // home page would render NotConnectedHome and TradeIsland would never
  // mount.
  //
  // SECURITY: the bypass requires BOTH gates simultaneously:
  //   1. NEXT_PUBLIC_BENTO_E2E === "1" at BUILD time (server-side env var
  //      baked into the client bundle). In a production deploy this is
  //      unset, so the entire `forceIsland` branch is statically dead code
  //      after tree-shaking — the query param literally cannot bypass the
  //      wallet gate in prod.
  //   2. `?force-island=1` at REQUEST time. This makes the bypass opt-in
  //      per-tab so accidentally loading the dev bundle locally doesn't
  //      auto-mount the island.
  //
  // Both conditions must hold. There is no path through this branch in
  // production.
  const forceIsland =
    process.env.NEXT_PUBLIC_BENTO_E2E === "1" &&
    searchParams?.get("force-island") === "1";

  if (!isConnectedAnyPath && !forceIsland) return <NotConnectedHome />;

  return <TradeIsland />;
};
