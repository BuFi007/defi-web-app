"use client";

import { useEffect, useState, type ReactNode } from "react";
import DynamicProviders from "@/context/DynamicProviders";

// IMPORTANT: import for its module-level side effect (purges Dynamic's
// localStorage session cache BEFORE the SDK gets a chance to rehydrate).
// Must come above the providers import so it runs first.
import "./DynamicSessionPurge";

// Client-only wrapper around DynamicProviders.
//
// Why: DynamicProviders pulls @dynamic-labs/* → @walletconnect/* → pino.
// Under Turbopack v16's SSR pass, that chain hits a Turbopack bug where
// auto-externalized packages get a content hash appended to their name.
// Wallet UIs are inherently client-only (they touch window.ethereum +
// localStorage + IndexedDB), so SSR-rendering them buys nothing.
//
// IMPLEMENTATION NOTE — DO NOT switch back to `next/dynamic({ ssr: false })`
// under Next 16 + `cacheComponents: true`. That combination fires a
// `BAILOUT_TO_CLIENT_SIDE_RENDERING` error during the SSR pass that
// propagates up THROUGH every client-component Suspense boundary in the
// [locale] layout (client Suspense boundaries do not catch server-side CSR
// bailouts inside a prerender dynamic hole) until it reaches the only
// server Suspense — the one in app/layout.tsx at `<Suspense
// fallback={null}>` — at which point the entire body renders empty AND
// the React tree fails to hydrate (no chrome, no welcome card, no
// skeleton). See iteration-1/alpha.md for the full trace.
//
// Instead we import DynamicProviders eagerly (the import statement is
// safe under Turbopack 16; only the SSR RENDER pass was the bug) and
// gate the RENDER behind a `mounted` flag. SSR + first hydration pass
// render `children` directly (a fragment, no DOM wrapper — matches
// what the client renders), then `useEffect` flips `mounted` to true
// and the next render wraps children in the wallet providers.
//
// Wallet-dependent components in `children` (BlockchainProvider's
// `useAccount`, etc.) are gated identically: on first paint they see
// no WagmiProvider, but `BlockchainProvider` runs them in a
// `useEffect` so the missing context only matters at render-time,
// which it doesn't touch on the SSR pass (BlockchainProvider DOES call
// useAccount at the top of its render — see TODO).

export default function ClientProviders({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // SSR + first client paint: render nothing visible. Children include
    // BlockchainProvider which calls `useAccount()` at render time, and
    // that throws without WagmiProvider — so we cannot render children
    // here without the providers. Page renders empty for one tick after
    // mount.
    return null;
  }

  return <DynamicProviders>{children}</DynamicProviders>;
}
