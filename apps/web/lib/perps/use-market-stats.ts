"use client";

/**
 * React-Query wrapper around /perps/markets/:sym/stats.
 *
 * Returns the 24h high/low/volume-proxy/change% from Pyth Benchmarks
 * via the api. Polls every 30s — Benchmarks updates roughly every
 * 15s for the FX feeds, so the cadence keeps stats fresh without
 * burning the upstream rate-limit.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { bufxApiUrl } from "@/lib/perps/replacement-agent";

export interface PerpsMarketStats {
  sym: string;
  source: "pyth-benchmarks" | "empty";
  high: number | null;
  low: number | null;
  volume: number | null;
  open: number | null;
  close: number | null;
  changePct: number | null;
}

const POLL_MS = 30_000;

export function useMarketStats(sym: string | undefined): UseQueryResult<PerpsMarketStats> {
  return useQuery({
    queryKey: ["perps", "market-stats", sym],
    enabled: Boolean(sym),
    queryFn: async ({ signal }): Promise<PerpsMarketStats> => {
      const url = bufxApiUrl(`/perps/markets/${encodeURIComponent(sym ?? "")}/stats`);
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new Error(`market-stats ${res.status}`);
      }
      return (await res.json()) as PerpsMarketStats;
    },
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
  });
}
