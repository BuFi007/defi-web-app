"use client";

/**
 * Browser-direct Pyth Hermes WebSocket hook.
 *
 * - One singleton `PythHermesStream` per page (lazy — only opens when the
 *   first hook mounts).
 * - `usePythHermesPrice(marketSym)` returns the latest tick (or `null`)
 *   plus an `isStale` flag (true when no tick has arrived in `staleAfterMs`).
 * - `usePythHermesPrices(symbols[])` is the batched version — one map,
 *   subscribed for the lifetime of the component.
 *
 * The hook handles symbol inversion for `USD/<CCY>` pairs (Pyth feeds the
 * `<CCY>/USD` rate; the chart wants the inverted value). Consumers see a
 * symbol-oriented price they can paint directly.
 */

import { useEffect, useRef, useState } from "react";
import {
  createPythHermesStream,
  isFxFeedInverted,
  pythFeedForFxSymbol,
  type PythHermesStream,
  type PythHermesTick,
} from "@bufi/market-data";

export interface UsePythHermesResult {
  /** The symbol-oriented mark price (inverted for `USD/<CCY>` pairs). */
  price: number | null;
  /** Pyth `publish_time` (unix seconds) of the last tick. */
  publishTime: number | null;
  /** Conf interval, already inverted/scaled to the same orientation. */
  conf: number | null;
  /** True when no tick has arrived in the last `staleAfterMs` (default 10s). */
  isStale: boolean;
}

// ---------- singleton stream (lazy) ----------

let sharedStream: PythHermesStream | null = null;
function getStream(): PythHermesStream {
  if (sharedStream) return sharedStream;
  sharedStream = createPythHermesStream();
  return sharedStream;
}

// ---------- helpers ----------

function orientForSymbol(symbol: string, tick: PythHermesTick): {
  price: number;
  conf: number;
  publishTime: number;
} {
  if (!isFxFeedInverted(symbol)) {
    return { price: tick.price, conf: tick.conf, publishTime: tick.publishTime };
  }
  if (!Number.isFinite(tick.price) || tick.price === 0) {
    return { price: NaN, conf: NaN, publishTime: tick.publishTime };
  }
  // Inverted pair: price -> 1/price. Confidence inversion follows the
  // first-order approximation conf' ≈ conf / price^2 (small relative to mark).
  const inv = 1 / tick.price;
  const confInv = tick.conf / (tick.price * tick.price);
  return { price: inv, conf: confInv, publishTime: tick.publishTime };
}

// ---------- single-symbol hook ----------

export function usePythHermesPrice(
  symbol: string | undefined,
  opts: { staleAfterMs?: number; enabled?: boolean } = {},
): UsePythHermesResult {
  const { staleAfterMs = 10_000, enabled = true } = opts;
  const [state, setState] = useState<UsePythHermesResult>({
    price: null,
    publishTime: null,
    conf: null,
    isStale: false,
  });
  const lastTickAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !symbol) return;
    const feedId = pythFeedForFxSymbol(symbol);
    if (!feedId) return;
    const stream = getStream();
    const unsubscribe = stream.subscribe(feedId, (raw) => {
      const oriented = orientForSymbol(symbol, raw);
      if (!Number.isFinite(oriented.price)) return;
      lastTickAtRef.current = Date.now();
      setState({
        price: oriented.price,
        publishTime: oriented.publishTime,
        conf: oriented.conf,
        isStale: false,
      });
    });

    // Stale watcher: flip isStale on after `staleAfterMs` with no tick.
    const staleTimer = setInterval(() => {
      if (!lastTickAtRef.current) return;
      const elapsed = Date.now() - lastTickAtRef.current;
      if (elapsed > staleAfterMs) {
        setState((s) => (s.isStale ? s : { ...s, isStale: true }));
      }
    }, Math.max(1000, Math.floor(staleAfterMs / 2)));

    return () => {
      clearInterval(staleTimer);
      unsubscribe();
    };
  }, [symbol, enabled, staleAfterMs]);

  return state;
}

// ---------- multi-symbol hook ----------

export function usePythHermesPrices(
  symbols: readonly string[],
  opts: { staleAfterMs?: number; enabled?: boolean } = {},
): Map<string, UsePythHermesResult> {
  const { staleAfterMs = 10_000, enabled = true } = opts;
  const [byId, setById] = useState<Map<string, UsePythHermesResult>>(
    () => new Map(),
  );
  const lastTickAtRef = useRef<Map<string, number>>(new Map());

  // Stable key — only re-subscribe when the symbol set actually changes.
  // Sort to avoid order-only churn.
  const key = [...symbols].sort().join("|");

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;
    const stream = getStream();
    const unsubs: Array<() => void> = [];
    for (const sym of symbols) {
      const feedId = pythFeedForFxSymbol(sym);
      if (!feedId) continue;
      const unsubscribe = stream.subscribe(feedId, (raw) => {
        const oriented = orientForSymbol(sym, raw);
        if (!Number.isFinite(oriented.price)) return;
        lastTickAtRef.current.set(sym, Date.now());
        setById((prev) => {
          const next = new Map(prev);
          next.set(sym, {
            price: oriented.price,
            publishTime: oriented.publishTime,
            conf: oriented.conf,
            isStale: false,
          });
          return next;
        });
      });
      unsubs.push(unsubscribe);
    }

    const staleTimer = setInterval(() => {
      const now = Date.now();
      const lastTicks = lastTickAtRef.current;
      let mutated = false;
      const pending: string[] = [];
      lastTicks.forEach((ts, sym) => {
        if (now - ts > staleAfterMs) pending.push(sym);
      });
      if (pending.length === 0) return;
      setById((prev) => {
        const next = new Map(prev);
        for (const sym of pending) {
          const cur = next.get(sym);
          if (cur && !cur.isStale) {
            next.set(sym, { ...cur, isStale: true });
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    }, Math.max(1000, Math.floor(staleAfterMs / 2)));

    return () => {
      clearInterval(staleTimer);
      for (const u of unsubs) u();
    };
    // `key` collapses symbol-array identity to a stable string so React's
    // dep diff doesn't re-subscribe on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, staleAfterMs]);

  return byId;
}
