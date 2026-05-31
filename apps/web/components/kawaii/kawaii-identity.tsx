"use client";

import { useEffect, useState } from "react";
import { KawaiiGate, type Catalog } from "@/components/kawaii/kawaii-gate";
import type { KawaiiMint } from "@/lib/kawaii/use-kawaii-beta";

/**
 * Kawaii Punks — IDENTITY TAB.
 *
 * One minimal surface: the embedded KawaiiGate left-panel customizer.
 *   - pre-mint  → the pink "NFT is NOT DEAD" gate + mint side
 *   - post-mint → drops straight into the single-panel avatar customizer
 *
 * The old post-mint profile dashboard + Sims-style Studio overlay were removed:
 * the mint left panel already does the customization, so the extra views were
 * redundant. `alreadyMinted={hasNft}` is what flips the gate to the customizer.
 */
export function KawaiiIdentity({ catalog, hasNft, mint, forceMint = false, refresh }: {
  catalog: Catalog;
  hasNft: boolean | null;
  mint: KawaiiMint | null;
  forceMint?: boolean; // "Upgrade to enter the leaderboard" → show the mint gate even if they hold a (testnet) Punk
  refresh?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className="identity-tab" style={{ position: "relative", height: "100%", minHeight: 380, flex: 1, padding: 10, margin: 0, maxWidth: "none", gap: 0, overflow: "hidden" }}>
      <KawaiiGate
        catalog={catalog}
        embedded
        alreadyMinted={!!hasNft && !forceMint}
        liveCid={mint?.ipfsCid ?? null}
        mintedBaseId={mint?.baseId ?? null}
        onMinted={() => refresh?.()}
      />
    </div>
  );
}
