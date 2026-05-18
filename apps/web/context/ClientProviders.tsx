"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Client-only wrapper around DynamicProviders.
//
// Why: DynamicProviders pulls @dynamic-labs/* → @walletconnect/* → pino.
// Under Turbopack v16's SSR pass, that chain hits a Turbopack bug where
// auto-externalized packages get a content hash appended to their name
// ("Cannot find package pino-<hash>"). The error surfaces in the
// browser as `on-recoverable-error: Switched to client rendering` plus
// `Failed to load external module pino-XXX`, and downstream as
// `WalletConnectProvider failed to initialize` + repeated MetaMask
// 4100 "not authorized" RPC errors.
//
// Wallet UIs are inherently client-only (they touch window.ethereum +
// localStorage + IndexedDB), so SSR-rendering them buys nothing. By
// loading via next/dynamic with `ssr: false`, the SSR bundle skips the
// entire chain and the bug never triggers.
const ProvidersInner = dynamic(
  () => import("@/context/DynamicProviders").then((m) => m.default ?? m),
  { ssr: false },
);

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <ProvidersInner>{children}</ProvidersInner>;
}
