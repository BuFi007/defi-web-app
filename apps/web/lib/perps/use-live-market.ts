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

import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * Publish every tick into React state. Turn this off for canvas charts
   * that consume ticks imperatively and only need status transitions.
   */
  publishTicks?: boolean;
  /** Optional imperative tick sink; does not force React re-renders. */
  onTick?: (tick: Tick) => void;
  /** Optional imperative orderbook sink; does not force React re-renders. */
  onObDelta?: (delta: ObDelta) => void;
  /** Milliseconds with no tick before flipping to 'stale'. Default 5000. */
  staleAfterMs?: number;
}

export interface UseLiveMarketResult {
  tick: Tick | null;
  obDelta: ObDelta | null;
  status: LiveMarketStatus;
}

const DEFAULT_STALE_MS = 5000;

type SharedListener = {
  onOpen?: () => void;
  onTick?: (tick: Tick) => void;
  onObDelta?: (delta: ObDelta) => void;
  onError?: (err: unknown) => void;
  onClose?: (info: { wasClean: boolean; code: number }) => void;
};

type SharedStream = {
  listeners: Set<SharedListener>;
  unsubscribe: () => void;
};

const sharedStreams = new Map<string, SharedStream>();

function sharedStreamKey(baseUrl: string, marketId: string): string {
  return `${baseUrl}\u0000${marketId}`;
}

function subscribeSharedMarketTicks(args: {
  baseUrl: string;
  marketId: string;
  listener: SharedListener;
}): () => void {
  const key = sharedStreamKey(args.baseUrl, args.marketId);
  let stream = sharedStreams.get(key);
  if (!stream) {
    const listeners = new Set<SharedListener>([args.listener]);
    const unsubscribe = subscribeMarketTicks({
      url: args.baseUrl,
      marketId: args.marketId,
      onOpen: () => {
        for (const listener of listeners) listener.onOpen?.();
      },
      onTick: (tick) => {
        for (const listener of listeners) listener.onTick?.(tick);
      },
      onObDelta: (delta) => {
        for (const listener of listeners) listener.onObDelta?.(delta);
      },
      onError: (err) => {
        for (const listener of listeners) listener.onError?.(err);
      },
      onClose: (info) => {
        for (const listener of listeners) listener.onClose?.(info);
      },
    });
    stream = { listeners, unsubscribe };
    sharedStreams.set(key, stream);
    return () => {
      const active = sharedStreams.get(key);
      if (!active) return;
      active.listeners.delete(args.listener);
      if (active.listeners.size === 0) {
        active.unsubscribe();
        sharedStreams.delete(key);
      }
    };
  }
  stream.listeners.add(args.listener);
  return () => {
    const active = sharedStreams.get(key);
    if (!active) return;
    active.listeners.delete(args.listener);
    if (active.listeners.size === 0) {
      active.unsubscribe();
      sharedStreams.delete(key);
    }
  };
}

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
  const {
    apiBaseUrl,
    enabled = true,
    publishTicks = true,
    staleAfterMs = DEFAULT_STALE_MS,
  } = options;
  const [tick, setTick] = useState<Tick | null>(null);
  const [obDelta, setObDelta] = useState<ObDelta | null>(null);
  const [status, setStatus] = useState<LiveMarketStatus>("connecting");
  const statusRef = useRef<LiveMarketStatus>("connecting");
  const lastTickAtRef = useRef<number>(0);
  const onTickRef = useRef<UseLiveMarketOptions["onTick"]>(options.onTick);
  const onObDeltaRef = useRef<UseLiveMarketOptions["onObDelta"]>(options.onObDelta);
  onTickRef.current = options.onTick;
  onObDeltaRef.current = options.onObDelta;
  const setStatusIfChanged = useCallback((next: LiveMarketStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!enabled || !marketId) {
      setStatusIfChanged("connecting");
      return;
    }
    const baseUrl = resolveApiBaseUrl(apiBaseUrl);
    if (!baseUrl) {
      // No env var configured — surface as 'error' so the chart falls back to
      // mock without ever showing an empty/blocked state.
      setStatusIfChanged("error");
      return;
    }
    setStatusIfChanged("connecting");

    const unsubscribe = subscribeSharedMarketTicks({
      baseUrl,
      marketId,
      listener: {
        onOpen: () => {
          setStatusIfChanged("connecting");
        },
        onTick: (t) => {
          lastTickAtRef.current = Date.now();
          onTickRef.current?.(t);
          if (publishTicks) setTick(t);
          setStatusIfChanged("live");
        },
        onObDelta: (d) => {
          onObDeltaRef.current?.(d);
          if (publishTicks) setObDelta(d);
        },
        onError: () => {
          setStatusIfChanged("error");
        },
        onClose: () => {
          // Client unsubscribed → no state change (effect cleanup follows).
          // Otherwise the reconnect loop will flip us back to 'connecting' and
          // eventually 'live'.
          setStatusIfChanged("connecting");
        },
      },
    });

    // Stale-watcher: cheap interval; only fires the 'stale' transition once.
    const staleTimer = setInterval(() => {
      const now = Date.now();
      if (!lastTickAtRef.current) return;
      if (now - lastTickAtRef.current > staleAfterMs && statusRef.current === "live") {
        setStatusIfChanged("stale");
      }
    }, Math.max(1000, Math.floor(staleAfterMs / 2)));

    return () => {
      clearInterval(staleTimer);
      unsubscribe();
    };
  }, [marketId, apiBaseUrl, enabled, publishTicks, staleAfterMs, setStatusIfChanged]);

  return { tick, obDelta, status };
}
