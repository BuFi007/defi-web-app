"use client";

/**
 * React hook wrapping `@bufi/market-data` `subscribeMarketTicks`.
 *
 * Status machine:
 *   - 'connecting' : initial mount + after a close while reconnecting
 *   - 'live'       : at least one tick received within `staleAfterMs`
 *   - 'stale'      : connected but no tick for `staleAfterMs` (default 5s)
 *   - 'error'      : socket reported an error (transient — flips back to
 *                    'connecting' on the next reconnect attempt)
 *
 * The hook is *idempotent* per (marketId, url) — unmount + remount produces
 * a clean subscription; React strict-mode double-invoke is safe.
 */

import { useEffect, useRef, useState } from "react";
import {
  subscribeMarketTicks,
  type ObDelta,
  type Tick,
} from "@bufi/market-data";

export type LiveMarketStatus =
  | "connecting"
  | "live"
  | "stale"
  | "error";

export interface UseLiveMarketOptions {
  /** Override the API base. Defaults to `NEXT_PUBLIC_API_URL`. */
  apiBaseUrl?: string;
  /** Disable the subscription entirely (e.g. feature flag off). */
  enabled?: boolean;
  /** Milliseconds with no tick before flipping to 'stale'. Default 5000. */
  staleAfterMs?: number;
}

export interface UseLiveMarketResult {
  tick: Tick | null;
  obDelta: ObDelta | null;
  status: LiveMarketStatus;
}

const DEFAULT_STALE_MS = 5000;

function resolveApiBaseUrl(override?: string): string | null {
  if (override) return override;
  // Same pattern as lib/bento/client.ts → bentoApiBaseUrl().
  const fromEnv =
    process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BUFI_API_URL;
  return fromEnv ?? null;
}

export function useLiveMarket(
  marketId: string,
  options: UseLiveMarketOptions = {},
): UseLiveMarketResult {
  const { apiBaseUrl, enabled = true, staleAfterMs = DEFAULT_STALE_MS } = options;
  const [tick, setTick] = useState<Tick | null>(null);
  const [obDelta, setObDelta] = useState<ObDelta | null>(null);
  const [status, setStatus] = useState<LiveMarketStatus>("connecting");
  const lastTickAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !marketId) {
      setStatus("connecting");
      return;
    }
    const baseUrl = resolveApiBaseUrl(apiBaseUrl);
    if (!baseUrl) {
      // No env var configured — surface as 'error' so the chart falls back to
      // mock without ever showing an empty/blocked state.
      setStatus("error");
      return;
    }
    setStatus("connecting");

    const unsubscribe = subscribeMarketTicks({
      url: baseUrl,
      marketId,
      onOpen: () => {
        setStatus("connecting");
      },
      onTick: (t) => {
        lastTickAtRef.current = Date.now();
        setTick(t);
        setStatus("live");
      },
      onObDelta: (d) => {
        setObDelta(d);
      },
      onError: () => {
        setStatus("error");
      },
      onClose: () => {
        // Client unsubscribed → no state change (effect cleanup follows).
        // Otherwise the reconnect loop will flip us back to 'connecting' and
        // eventually 'live'.
        setStatus("connecting");
      },
    });

    // Stale-watcher: cheap interval; only fires the 'stale' transition once.
    const staleTimer = setInterval(() => {
      const now = Date.now();
      if (!lastTickAtRef.current) return;
      if (now - lastTickAtRef.current > staleAfterMs) {
        setStatus((s) => (s === "live" ? "stale" : s));
      }
    }, Math.max(1000, Math.floor(staleAfterMs / 2)));

    return () => {
      clearInterval(staleTimer);
      unsubscribe();
    };
  }, [marketId, apiBaseUrl, enabled, staleAfterMs]);

  return { tick, obDelta, status };
}
