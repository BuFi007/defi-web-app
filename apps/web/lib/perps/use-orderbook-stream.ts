"use client";

/**
 * React hook that opens a WS subscription to the realtime fan-out channels
 * for one market (Wave E6 — apps/api/src/lib/REALTIME.md).
 *
 * The wire side delivers a `RealtimeEnvelope` per frame:
 *
 *   { type: "realtime", channel, kind, marketId, data }
 *
 * with `kind` in {"trades", "book", "funding"}. We demux into three
 * separate state slices so the consumer can render a trade tape, an
 * orderbook table, and a funding-rate badge without a switch statement
 * in every component.
 *
 * Reconnect: exponential backoff capped at 30s — mirrors the pattern in
 * `packages/market-data/src/ws.ts` (`subscribeMarketTicks`). We don't
 * reuse `subscribeMarketTicks` directly because that helper parses the
 * Pyth tick + obDelta payload shape, not the realtime envelope, and
 * the two coexist on the same socket.
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ---------- wire shapes (must stay in sync with apps/api/src/lib/realtime.ts) ----------

export type RealtimeChannelKind = "trades" | "book" | "funding";

export interface TradeMessage {
  priceE18: string;
  sizeE18: string;
  side: "long" | "short";
  txHash?: string;
  taker?: string;
  ts: number;
}

export interface BookMessage {
  sequence: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  ts: number;
}

export interface FundingMessage {
  rateE18: string;
  markE18: string;
  ts: number;
}

interface BaseEnvelope {
  type: "realtime";
  channel: string;
  marketId: string;
}

export type RealtimeEnvelope =
  | (BaseEnvelope & { kind: "trades"; data: TradeMessage })
  | (BaseEnvelope & { kind: "book"; data: BookMessage })
  | (BaseEnvelope & { kind: "funding"; data: FundingMessage });

// ---------- hook ----------

export interface UseOrderbookStreamOptions {
  /** Override the API base. Defaults to `NEXT_PUBLIC_API_URL`. */
  apiBaseUrl?: string;
  /** Disable the subscription (e.g. feature flag off). */
  enabled?: boolean;
  /**
   * Cap on the in-memory trades buffer. Older trades fall off the bottom
   * when the buffer exceeds this. Default 200 — enough for a decent
   * tape, small enough that React renders stay snappy.
   */
  maxTrades?: number;
}

export interface UseOrderbookStreamResult {
  /** Trade tape, newest-first. Bounded by `maxTrades`. */
  trades: TradeMessage[];
  /** Latest orderbook snapshot, or null until the first BOOK frame. */
  book: BookMessage | null;
  /** Latest funding-rate snapshot, or null until the first FUNDING frame. */
  funding: FundingMessage | null;
  /** True once the underlying WebSocket transitioned to OPEN. */
  isConnected: boolean;
  /** Unix ms of the last frame received (any kind). 0 until first frame. */
  lastUpdate: number;
}

const DEFAULT_MAX_TRADES = 200;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

function resolveApiBaseUrl(override?: string): string | null {
  if (override) return override;
  const fromEnv =
    process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BUFI_API_URL;
  return fromEnv ?? null;
}

function buildWsUrl(baseUrl: string, marketId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  let scheme = trimmed;
  if (scheme.startsWith("http://")) scheme = "ws://" + scheme.slice("http://".length);
  else if (scheme.startsWith("https://")) scheme = "wss://" + scheme.slice("https://".length);
  return `${scheme}/ws/markets/${encodeURIComponent(marketId)}`;
}

/**
 * Subscribe to the realtime channels for one market. Returns a reactive
 * snapshot of trades / book / funding + connection status.
 *
 * Idempotent per (marketId, apiBaseUrl): unmount + remount produces a
 * fresh subscription. React strict-mode double-invoke is safe.
 */
export function useOrderbookStream(
  marketId: string,
  options: UseOrderbookStreamOptions = {},
): UseOrderbookStreamResult {
  const { apiBaseUrl, enabled = true, maxTrades = DEFAULT_MAX_TRADES } = options;

  const [trades, setTrades] = useState<TradeMessage[]>([]);
  const [book, setBook] = useState<BookMessage | null>(null);
  const [funding, setFunding] = useState<FundingMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);

  // Stable callbacks ref-bag so the effect deps only depend on the inputs
  // that actually drive a reconnect. `maxTrades` is read off the ref every
  // time we push a trade so it can change without recreating the socket.
  const maxTradesRef = useRef(maxTrades);
  maxTradesRef.current = maxTrades;

  useEffect(() => {
    if (!enabled || !marketId) return;
    const baseUrl = resolveApiBaseUrl(apiBaseUrl);
    if (!baseUrl) {
      // No env var — treat as disabled. Consumer renders an empty tape
      // and the connection-status indicator stays "false" so the UI can
      // show a friendly "realtime feed not configured" message.
      return;
    }
    const wsUrl = buildWsUrl(baseUrl, marketId);

    let stopped = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleEnvelope = (env: RealtimeEnvelope) => {
      setLastUpdate(Date.now());
      // Discriminated-union narrowing — the union covers all kinds, so
      // each branch is exhaustive. A future channel kind without a hook
      // update would surface as a TS error on the union member.
      if (env.kind === "trades") {
        setTrades((prev) => {
          // Newest-first, capped — bounded buffer means render cost stays
          // O(maxTrades) regardless of session length.
          const next = [env.data, ...prev];
          const cap = maxTradesRef.current;
          if (next.length > cap) next.length = cap;
          return next;
        });
      } else if (env.kind === "book") {
        setBook((prev) => {
          // Drop out-of-order frames (sequence < known sequence). Same
          // ordering guarantee as the obDelta path in subscribeMarketTicks.
          if (prev && env.data.sequence < prev.sequence) return prev;
          return env.data;
        });
      } else if (env.kind === "funding") {
        setFunding(env.data);
      }
    };

    const connect = () => {
      if (stopped) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        setIsConnected(true);
      };
      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          const parsed = JSON.parse(raw) as { type?: string } & Record<string, unknown>;
          // Only forward realtime envelopes — the same socket also
          // delivers the Pyth tick + obDelta frames the scaffold has
          // shipped since Sprint D. Those are handled by `useLiveMarket`,
          // not this hook.
          if (parsed.type !== "realtime") return;
          handleEnvelope(parsed as unknown as RealtimeEnvelope);
        } catch {
          // Malformed frame — drop silently. The server should never emit
          // un-parseable JSON; a recurring drop here would show up as
          // "trades stop arriving" which is the right symptom to debug
          // upstream, not to surface as a hook error.
        }
      };
      ws.onerror = () => {
        // Browsers don't expose details for ws errors; the onclose handler
        // does the actual reconnect bookkeeping.
      };
      ws.onclose = () => {
        socket = null;
        setIsConnected(false);
        if (!stopped) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = RECONNECT_BACKOFF_MS[
        Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)
      ];
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socket) {
        try {
          socket.close(1000, "client_unsubscribe");
        } catch {
          // ignore — socket may already be closing.
        }
        socket = null;
      }
    };
  }, [marketId, apiBaseUrl, enabled]);

  return useMemo(
    () => ({ trades, book, funding, isConnected, lastUpdate }),
    [trades, book, funding, isConnected, lastUpdate],
  );
}
