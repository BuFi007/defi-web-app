"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { KawaiiGate, type Catalog } from "./kawaii-gate";

/**
 * Self-gating mount for the Kawaii invite gate. Renders the overlay ONLY when a
 * wallet is connected and holds no Kawaii Punk. Additive: returns null otherwise,
 * and fails OPEN on any status error so a gate hiccup never locks users out of
 * the working app.
 */
export function KawaiiGateMount() {
  const { address, isConnected } = useAccount();
  const [hasNft, setHasNft] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setHasNft(null);
      return;
    }
    fetch(`/api/kawaii/status?wallet=${address}`)
      .then((r) => r.json())
      .then((d) => setHasNft(!!d.hasNft))
      .catch(() => setHasNft(true)); // fail-open: don't block the app on error
    fetch(`/api/kawaii/catalog`)
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => {});
  }, [isConnected, address]);

  if (!isConnected || hasNft !== false || !catalog) return null;
  return <KawaiiGate catalog={catalog} />;
}
