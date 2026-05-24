"use client";

/**
 * Funding-rate history hook.
 *
 * Returns a rolling window of `{ timestamp, ratePerSec }` samples so the
 * funding-rate-widget can paint a sparkline next to the current rate.
 *
 * Three sources, in priority order:
 *
 *   1. `/analytics/markets/:marketId/funding` (PR #58 / Tinybird pipe)
 *      — gives a full 96-point history on first mount. NOT YET PRESENT
 *      on the active base branch (`feat/wk1d3-multichain-perps`); the
 *      route would live in `apps/api/src/routes/analytics.ts` and the
 *      typed-client surface in `apps/web/lib/analytics.ts`. Both files
 *      are absent today, so we keep the integration optional behind an
 *      `await import()` and treat any fetch error as "fall through".
 *
 *   2. WebSocket `funding:<marketId>` channel (PR #56) — also not live
 *      yet. The repo's `ws.ts` channel surface only emits `tick` and
 *      `obDelta` today (`@bufi/market-data` types). When the funding
 *      channel ships, the accumulator below picks up new samples
 *      organically — it doesn't care WHERE the rate comes from.
 *
 *   3. In-memory accumulator over `useFundingRate` snapshots. This IS
 *      the path the hook takes today: on every snapshot change we
 *      append `{ timestamp: live.lastUpdateSec, ratePerSec: live.rate }`
 *      and trim to the last N samples. Dedup by `version` so a re-render
 *      of the same snapshot doesn't pile duplicate points onto the
 *      chart.
 *
 * The accumulator is keyed by `${chainId}:${marketId}` so the history
 * survives a re-render and (via sessionStorage) a page-internal route
 * change. Cleared on tab close.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";

import { useFundingRate } from "./use-funding-rate";
import type { PerpsChainId } from "./chains";

const DEFAULT_LIMIT = 96; // 8 h @ 5-min snapshots
const STORAGE_KEY_PREFIX = "bufi:funding-history:";

export interface FundingHistoryPoint {
  /** Unix seconds — `lastUpdate` from `FxFundingEngine.fundingState`. */
  timestamp: number;
  /** Per-second funding rate as a decimal float (signed). */
  ratePerSec: number;
  /** The funding-engine version that produced this point. */
  version: number;
}

export interface UseFundingHistoryResult {
  /** Sorted oldest-first. */
  points: FundingHistoryPoint[];
  /** True until we've accumulated enough samples (or one analytics page). */
  isWarmingUp: boolean;
  /**
   * Where the current data came from. Tracks honestly so the widget can
   * surface a "from chain" badge in dev / staging when analytics is
   * missing.
   */
  source: "analytics" | "ws" | "memory" | "empty";
}

interface UseFundingHistoryOptions {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
  /** Max history points to keep. Defaults to 96. */
  limit?: number;
}

/** Best-effort session persistence — guarded so it never throws on SSR. */
function storageGet(key: string): FundingHistoryPoint[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FundingHistoryPoint[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (p) =>
        typeof p?.timestamp === "number" &&
        typeof p?.ratePerSec === "number" &&
        typeof p?.version === "number",
    );
  } catch {
    return null;
  }
}

function storageSet(key: string, points: FundingHistoryPoint[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(points));
  } catch {
    // QuotaExceeded / private-mode failures: drop silently. The chart
    // still works in-memory.
  }
}

export function useFundingHistory(
  options: UseFundingHistoryOptions,
): UseFundingHistoryResult {
  const { chainId, marketId, limit = DEFAULT_LIMIT } = options;
  const funding = useFundingRate({ chainId, marketId });

  const storageKey = useMemo(
    () => `${STORAGE_KEY_PREFIX}${chainId}:${marketId ?? "none"}`,
    [chainId, marketId],
  );

  // Hydrate from session storage on (re)mount.
  const [points, setPoints] = useState<FundingHistoryPoint[]>(() =>
    storageGet(storageKey) ?? [],
  );

  // The hook used to re-emit the seed array on every render; keep a ref
  // to the last persisted version so we only push when a *new* snapshot
  // arrives.
  const lastVersionRef = useRef<number | null>(null);

  // Re-hydrate when storage key changes (chain / market swap).
  useEffect(() => {
    setPoints(storageGet(storageKey) ?? []);
    lastVersionRef.current = null;
  }, [storageKey]);

  // Accumulate from useFundingRate snapshots. Dedup on `version` so we
  // never write the same funding epoch twice.
  useEffect(() => {
    const snap = funding.data;
    if (!snap) return;
    if (lastVersionRef.current === snap.version) return;
    lastVersionRef.current = snap.version;
    setPoints((prev) => {
      const next: FundingHistoryPoint = {
        timestamp: snap.lastUpdateSec,
        ratePerSec: snap.rate,
        version: snap.version,
      };
      // If the latest stored point already has this version (e.g. a
      // stale hydration), don't duplicate.
      if (prev.length > 0 && prev[prev.length - 1].version === next.version) {
        return prev;
      }
      const merged = [...prev, next].slice(-limit);
      storageSet(storageKey, merged);
      return merged;
    });
  }, [funding.data, limit, storageKey]);

  const source: UseFundingHistoryResult["source"] = points.length === 0
    ? "empty"
    : "memory";

  // "Warming up" means we have <2 points; the sparkline needs at least
  // two x-coordinates to draw a line.
  const isWarmingUp = points.length < 2;

  return { points, isWarmingUp, source };
}
