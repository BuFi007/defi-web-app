"use client";

/**
 * WebSocket client for the Hybrid CLOB sequencer (Phase 3).
 *
 * Singleton connection to the matcher's WS gateway. Handles:
 * - Auto-reconnect with exponential backoff
 * - Place / cancel order submission with promise-based ack
 * - Book snapshot + delta subscriptions (future)
 *
 * The WS URL is derived from NEXT_PUBLIC_API_URL by swapping the
 * scheme (http→ws, https→wss) and appending /ws-seq/v1/markets.
 * Override with NEXT_PUBLIC_MATCHER_WS_URL for direct connection.
 */

type AckCallback = (msg: SequencerAck) => void;

export interface SequencerAck {
  type: "ack" | "cancelAck" | "error";
  intentId?: string;
  status: string;
  fills?: number;
  reason?: string;
}

export interface SignedOrderPayload {
  trader: string;
  marketId: string;
  sizeDeltaE18: string;
  priceE18: string;
  nonce: string;
  deadline: number;
  orderType: number;
  flags: number;
}

let instance: SequencerWsClient | null = null;

export function getSequencerClient(): SequencerWsClient {
  if (!instance) {
    instance = new SequencerWsClient();
  }
  return instance;
}

function resolveWsUrl(): string | null {
  if (typeof window === "undefined") return null;
  const override = process.env.NEXT_PUBLIC_MATCHER_WS_URL;
  if (override) return override;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL;
  if (!apiUrl) return null;
  const trimmed = apiUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("https://"))
    return "wss://" + trimmed.slice("https://".length) + "/ws-seq/v1/markets";
  if (trimmed.startsWith("http://"))
    return "ws://" + trimmed.slice("http://".length) + "/ws-seq/v1/markets";
  return null;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 500;

export class SequencerWsClient {
  private ws: WebSocket | null = null;
  private url: string | null;
  private backoff = INITIAL_BACKOFF_MS;
  private pendingAcks = new Map<string, AckCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor() {
    this.url = resolveWsUrl();
    if (this.url) this.connect();
  }

  get connected(): boolean {
    return this._connected;
  }

  get available(): boolean {
    return this.url !== null;
  }

  private connect() {
    if (!this.url) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.backoff = INITIAL_BACKOFF_MS;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SequencerAck;
        if (msg.intentId && this.pendingAcks.has(msg.intentId)) {
          const cb = this.pendingAcks.get(msg.intentId)!;
          this.pendingAcks.delete(msg.intentId);
          cb(msg);
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  async place(
    signedOrder: SignedOrderPayload,
    signature: string,
  ): Promise<SequencerAck> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("sequencer WS not connected"));
        return;
      }

      const nonce = signedOrder.nonce;
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(nonce);
        reject(new Error("sequencer ack timeout (5s)"));
      }, 5_000);

      this.pendingAcks.set(nonce, (ack) => {
        clearTimeout(timeout);
        resolve(ack);
      });

      this.ws.send(
        JSON.stringify({
          action: "place",
          signedOrder,
          signature,
        }),
      );
    });
  }

  async cancel(intentId: string): Promise<SequencerAck> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("sequencer WS not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingAcks.delete(intentId);
        reject(new Error("sequencer cancel timeout (5s)"));
      }, 5_000);

      this.pendingAcks.set(intentId, (ack) => {
        clearTimeout(timeout);
        resolve(ack);
      });

      this.ws.send(
        JSON.stringify({
          action: "cancel",
          intentId,
        }),
      );
    });
  }

  destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.pendingAcks.clear();
    instance = null;
  }
}
