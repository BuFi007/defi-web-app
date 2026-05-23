"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * GhostMode — global privacy state for BUFI.
 *
 * Ghost Mode = the user has opted into private trading. The flag is
 * the canonical user intent; the theme toggle is a visual side-effect
 * of it, NOT the other way around.
 *
 * Trade routing reads `useGhostMode().isGhostMode` to decide between
 * public and private code paths. State survives reloads via
 * localStorage. Cross-tab sync via the storage event.
 *
 * On-chain privacy availability is a SEPARATE concern from user intent:
 * a user may toggle Ghost Mode on while the Privacy Hook is paused or
 * not yet wired for the user's chain. Use `usePrivacyState()` /
 * `usePrivacyAssets()` from `@/lib/privacy/hooks` to read what's
 * actually deployed.
 */
export type GhostModeContextValue = {
  /** True when private trading is enabled. */
  isGhostMode: boolean;
  /** Explicit setter — pass `true` to enter Ghost Mode, `false` to leave. */
  setGhostMode: (next: boolean) => void;
  /** Convenience: flip the current value. */
  toggleGhostMode: () => void;
  /** True once the client has hydrated from localStorage. Useful to avoid SSR/CSR mismatches in trade paths. */
  isHydrated: boolean;
};

const GhostModeContext = createContext<GhostModeContextValue | null>(null);

const STORAGE_KEY = "bufi:ghost-mode";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStored(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export function GhostModeProvider({ children }: { children: ReactNode }) {
  // SSR safe: start `false`, hydrate from localStorage on mount.
  const [isGhostMode, setIsGhostMode] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  useEffect(() => {
    setIsGhostMode(readStored());
    setIsHydrated(true);
  }, []);

  // Cross-tab sync: if Ghost Mode is toggled in another tab, mirror it here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setIsGhostMode(event.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setGhostMode = useCallback((next: boolean) => {
    setIsGhostMode(next);
    writeStored(next);
  }, []);

  const toggleGhostMode = useCallback(() => {
    setIsGhostMode((current) => {
      const next = !current;
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo<GhostModeContextValue>(
    () => ({ isGhostMode, setGhostMode, toggleGhostMode, isHydrated }),
    [isGhostMode, setGhostMode, toggleGhostMode, isHydrated],
  );

  return (
    <GhostModeContext.Provider value={value}>
      {children}
    </GhostModeContext.Provider>
  );
}

/**
 * Access Ghost Mode state. Throws if called outside <GhostModeProvider>.
 * Use this in any client component that needs to know whether the user
 * has opted into private trading.
 */
export function useGhostMode(): GhostModeContextValue {
  const ctx = useContext(GhostModeContext);
  if (!ctx) {
    throw new Error(
      "useGhostMode must be used inside <GhostModeProvider>. " +
        "Wrap your tree in app/[locale]/layout.tsx.",
    );
  }
  return ctx;
}
