"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persists the dynamic-island tab across refreshes (localStorage). On reload a
 * Punk HOLDER lands back on the same tab they left. `seenHolder` is an
 * optimistic hint from the last session: a returning holder restores their tab
 * immediately (no identity-tab flash while the async hasNft check resolves),
 * while a new/non-holder defaults to the identity gate. The live on-chain
 * hasNft check still has the final say (it self-corrects if the hint is stale).
 */
interface IslandTabState {
  tab: string;
  seenHolder: boolean;
  setTab: (tab: string) => void;
  setSeenHolder: (v: boolean) => void;
}

export const useIslandTab = create<IslandTabState>()(
  persist(
    (set) => ({
      tab: "loan",
      seenHolder: false,
      setTab: (tab) => set({ tab }),
      setSeenHolder: (seenHolder) => set({ seenHolder }),
    }),
    { name: "bufi-island-tab" },
  ),
);
