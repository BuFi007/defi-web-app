"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Catalog } from "@/components/kawaii/kawaii-gate";

/**
 * Resolves the connected wallet's Kawaii beta state for the home router:
 *   - hasNft: true (holds a Punk) | false (no Punk → show the minter view)
 *     | null (loading / unknown → FAIL OPEN to the app, never block).
 *   - catalog: the mint catalog (bases + reserved + traits) for the view.
 *
 * Mirrors the old KawaiiGateMount fetch, lifted so HomeContent can gate the
 * nft-beta VIEW (in-flow) instead of stacking an overlay on top of the island.
 */
export type KawaiiMint = {
  tier: string | null;
  baseId: string | null;
  tokenId: string | null;
  agentId: string | null; // ERC-8004 badge (agentic Punk) | null for humans
  ipfsCid: string | null; // live metadata CID → "View on IPFS"
  mintedAt: string | null;
};

export function useKawaiiBeta() {
  const { address, isConnected } = useAccount();
  const [hasNft, setHasNft] = useState<boolean | null>(null);
  const [mint, setMint] = useState<KawaiiMint | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [nonce, setNonce] = useState(0);

  // Bump to re-check status after a mint (flips hasNft → unlocks the tabs).
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isConnected || !address) {
      setHasNft(null);
      setMint(null);
      return;
    }
    fetch(`/api/kawaii/status?wallet=${address}`)
      .then((r) => r.json())
      .then((d) => {
        setHasNft(!!d.hasNft);
        setMint(d.hasNft ? { tier: d.tier, baseId: d.baseId, tokenId: d.tokenId, agentId: d.agentId, ipfsCid: d.ipfsCid, mintedAt: d.mintedAt } : null);
      })
      .catch(() => setHasNft(true)); // fail-open: a status hiccup never gates the app
    fetch(`/api/kawaii/catalog`)
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => {});
  }, [isConnected, address, nonce]);

  return { hasNft, mint, catalog, refetch };
}
