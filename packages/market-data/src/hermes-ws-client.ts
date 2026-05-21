/**
 * Browser-side `wss://hermes.pyth.network/ws` client.
 *
 * Multiplexes N feed subscriptions over ONE WebSocket connection. Each
 * `subscribe(feedId, onTick)` returns an unsubscribe; the socket only stays
 * open while at least one feed has an active listener.
 *
 * Wire protocol (Pyth Hermes v2):
 *   client → {"type":"subscribe","ids":["<hex>", ...]}
 *   client → {"type":"unsubscribe","ids":["<hex>", ...]}
 *   server → {"type":"price_update","price_feed":{
 *               "id":"<hex>",
 *               "price":{"price":"...","conf":"...","expo":number,"publish_time":number}
 *            }}
 *   server → {"type":"response","status":"success"}  // ack
 *
 * Reconnect: exponential backoff 1s/2s/4s/8s/16s/30s (capped). On reopen we
 * re-subscribe to every active feed. Subscriptions added while disconnected
 * are queued and flushed on `open`.
 *
 * Browser-only. Node usage would require a polyfill. We pick whichever
 * WebSocket impl exists on `globalThis.WebSocket` at call time so the
 * server-rendered import path doesn't crash — server returns a no-op
 * unsubscribe immediately.
 */

import type { Hex } from "viem";

// ---------- public types ----------

export interface PythHermesTick {
  /** Hex feed id (no 0x prefix), lowercase — matches Pyth `price_feed.id`. */
  feedId: string;
  /** Raw `(price, expo)` decoded to a JS number. Lossy beyond ~15 sig figs. */
  price: number;
  /** Confidence interval, same unit/scale as `price`. */
  conf: number;
  /** Pyth `publish_time` in unix seconds. */
  publishTime: number;
}

export type PythTickListener = (tick: PythHermesTick) => void;

export interface PythHermesStreamOptions {
  /** Override URL (tests). Defaults to `wss://hermes.pyth.network/ws`. */
  url?: string;
  /** Override `WebSocket` impl (tests). Defaults to `globalThis.WebSocket`. */
  webSocketImpl?: typeof WebSocket;
  /** Override backoff sequence (ms). */
  reconnectDelaysMs?: number[];
}

export interface PythHermesStream {
  /** Subscribe a callback to one feed. Returns an unsubscribe. Idempotent
   *  across multiple callers on the same feedId — the socket subscribe-frame
   *  is only sent once for the first listener, and the unsubscribe-frame is
   *  only sent when the last listener detaches. */
  subscribe(feedId: Hex | string, listener: PythTickListener): () => void;
  /** Tear down the socket + cancel any pending reconnects. After `close()`
   *  the instance is dead; create a new one if you need a fresh stream. */
  close(): void;
}

// ---------- constants ----------

export const HERMES_DEFAULT_WS_URL = "wss://hermes.pyth.network/ws";

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];

// ---------- helpers ----------

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2).toLowerCase() : hex.toLowerCase();
}

/** Convert Pyth's `(price, expo)` to a JS number. Pyth uses negative expo
 *  for sub-unit precision (e.g. price=110234500000, expo=-8 → 1102.345). */
export function decodePythPrice(raw: string | number, expo: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(value)) return NaN;
  return value * Math.pow(10, expo);
}

// ---------- wire payload guards ----------

interface PythHermesUpdateMessage {
  type: "price_update";
  price_feed: {
    id: string;
    price: {
      price: string | number;
      conf: string | number;
      expo: number;
      publish_time: number;
    };
  };
}

function isUpdate(msg: unknown): msg is PythHermesUpdateMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== "price_update") return false;
  const pf = m.price_feed as Record<string, unknown> | undefined;
  if (!pf || typeof pf.id !== "string") return false;
  const p = pf.price as Record<string, unknown> | undefined;
  if (!p) return false;
  return (
    (typeof p.price === "string" || typeof p.price === "number") &&
    typeof p.expo === "number" &&
    typeof p.publish_time === "number"
  );
}

// ---------- implementation ----------

class PythHermesStreamImpl implements PythHermesStream {
  private readonly url: string;
  private readonly WSImpl: typeof WebSocket | undefined;
  private readonly backoff: number[];
  // feedId (no 0x, lowercase) → set of listeners
  private readonly listeners = new Map<string, Set<PythTickListener>>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;
  // Tracks which feeds we've actually sent a `subscribe` frame for on the
  // current socket. Lets us send `unsubscribe` when the last listener leaves.
  private readonly subscribedOnSocket = new Set<string>();

  constructor(opts: PythHermesStreamOptions = {}) {
    this.url = opts.url ?? HERMES_DEFAULT_WS_URL;
    this.WSImpl =
      opts.webSocketImpl ??
      (typeof globalThis !== "undefined"
        ? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
        : undefined);
    this.backoff = opts.reconnectDelaysMs ?? DEFAULT_BACKOFF_MS;
  }

  subscribe(feedId: Hex | string, listener: PythTickListener): () => void {
    if (this.closed) return () => {};
    const id = strip0x(String(feedId));
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    // Lazily open the socket on first subscribe.
    if (!this.ws) {
      this.connect();
    } else if (this.ws.readyState === 1 /* OPEN */) {
      // Send a subscribe frame for this feed if we haven't already on this socket.
      if (!this.subscribedOnSocket.has(id)) {
        this.send({ type: "subscribe", ids: [id] });
        this.subscribedOnSocket.add(id);
      }
    }
    // Otherwise: socket is still CONNECTING; `onopen` will flush all known feeds.

    return () => {
      const current = this.listeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(id);
        if (this.ws?.readyState === 1 && this.subscribedOnSocket.has(id)) {
          this.send({ type: "unsubscribe", ids: [id] });
          this.subscribedOnSocket.delete(id);
        }
      }
      // If no feeds remain at all, tear down the socket — we'll re-open on the
      // next subscribe call. Saves a hanging WS when the user navigates away.
      if (this.listeners.size === 0) {
        this.teardownSocket();
      }
    };
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.teardownSocket();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---------- internals ----------

  private connect(): void {
    if (this.closed) return;
    if (!this.WSImpl) return; // SSR / non-browser — silently noop.
    if (this.ws) return; // already connecting/open.

    let socket: WebSocket;
    try {
      socket = new this.WSImpl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.subscribedOnSocket.clear();

    socket.onopen = () => {
      this.attempt = 0;
      // Re-subscribe to every known feed in a single frame. Pyth accepts an
      // array of ids per `subscribe` request.
      const ids = Array.from(this.listeners.keys());
      if (ids.length > 0) {
        this.send({ type: "subscribe", ids });
        for (const id of ids) this.subscribedOnSocket.add(id);
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : String(event.data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!isUpdate(parsed)) return;
      const feedId = strip0x(parsed.price_feed.id);
      const set = this.listeners.get(feedId);
      if (!set || set.size === 0) return;
      const { price, conf, expo, publish_time } = parsed.price_feed.price;
      const tick: PythHermesTick = {
        feedId,
        price: decodePythPrice(price, expo),
        conf: decodePythPrice(conf, expo),
        publishTime: publish_time,
      };
      // Defensive copy so listener mutations don't trash the iteration.
      for (const fn of Array.from(set)) {
        try {
          fn(tick);
        } catch {
          // Swallow per-listener throw so one buggy consumer doesn't kill
          // ticks for every other subscriber.
        }
      }
    };

    socket.onerror = () => {
      // No state change here; `onclose` will fire and drive the reconnect.
    };

    socket.onclose = () => {
      this.ws = null;
      this.subscribedOnSocket.clear();
      if (this.closed) return;
      if (this.listeners.size === 0) return; // nothing left to feed.
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    const delay =
      this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 30_000;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.subscribedOnSocket.clear();
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close(1000, "client_close");
    } catch {
      // ignore.
    }
  }

  private send(payload: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore — the socket will surface the failure via onclose.
    }
  }
}

/**
 * Construct a fresh Hermes WS stream. Most callers want one stream per page
 * (use the singleton-shaped React hook in `apps/web/lib/market-data` instead
 * of calling this directly).
 */
export function createPythHermesStream(
  opts: PythHermesStreamOptions = {},
): PythHermesStream {
  return new PythHermesStreamImpl(opts);
}
