/**
 * Typed WebSocket client for `@bufi/api`'s live-market scaffold.
 *
 * Mirrors the server's discriminated union (Tick | ObDelta) and includes
 * auto-reconnect with exponential backoff so the chart hook never has to deal
 * with raw `WebSocket` semantics.
 *
 * Wire-side bigints arrive as decimal strings; consumers that need bigint
 * precision can call `BigInt(tick.markE18)`. The default flow exposes both
 * the raw string and a parsed `mark` number (lossy but UI-safe).
 */

// ---------- raw wire types (string-encoded bigints) ----------

interface RawLastCandle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface RawTick {
  type: "tick";
  marketId: string;
  ts: number;
  mark: string;
  bid: string;
  ask: string;
  lastCandle: RawLastCandle;
}

interface RawObDelta {
  type: "obDelta";
  marketId: string;
  sequence: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

type RawMessage = RawTick | RawObDelta;

// ---------- parsed types exposed to callers ----------

export interface Tick {
  type: "tick";
  marketId: string;
  ts: number;
  /** Number representation — convenient for UI. Use `markE18` for precision. */
  mark: number;
  bid: number;
  ask: number;
  /** Lossless bigint of the E18-scaled mark. */
  markE18: bigint;
  bidE18: bigint;
  askE18: bigint;
  lastCandle: RawLastCandle;
}

export interface ObLevel {
  /** Decimal-string E18, preserved as-is from the wire. */
  priceE18: string;
  /** Decimal-string E18 size. */
  sizeE18: string;
  /** Lossy float conversion for UI rendering. */
  price: number;
  size: number;
}

export interface ObDelta {
  type: "obDelta";
  marketId: string;
  sequence: number;
  bids: ObLevel[];
  asks: ObLevel[];
}

export type MarketsWsEvent = Tick | ObDelta;

// ---------- subscribe API ----------

export interface SubscribeOptions {
  /** Base URL — http(s) or ws(s). Trailing slash is tolerated. */
  url: string;
  /** Market id segment used in `/ws/markets/:marketId`. */
  marketId: string;
  onTick?: (tick: Tick) => void;
  onObDelta?: (delta: ObDelta) => void;
  onError?: (err: unknown) => void;
  /** Open/close transitions — used by the React hook to drive status. */
  onOpen?: () => void;
  onClose?: (info: { wasClean: boolean; code: number }) => void;
  /** Test injection. Defaults to global `WebSocket`. */
  webSocketImpl?: typeof WebSocket;
  /** Override backoff sequence (ms). Defaults to 1s, 2s, 5s, 10s, 30s cap. */
  reconnectDelaysMs?: number[];
  /** Disable auto-reconnect (tests). */
  noReconnect?: boolean;
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Open a subscription to `/ws/markets/:marketId`.
 *
 * Returns an `unsubscribe` function. Calling it closes the socket and
 * prevents any further reconnect attempts.
 */
export function subscribeMarketTicks(opts: SubscribeOptions): () => void {
  const WSImpl = opts.webSocketImpl ?? (globalThis.WebSocket as typeof WebSocket | undefined);
  if (!WSImpl) {
    opts.onError?.(new Error("WebSocket is not available in this runtime"));
    return () => {};
  }
  const delays = opts.reconnectDelaysMs ?? DEFAULT_BACKOFF_MS;
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const wsUrl = buildWsUrl(opts.url, opts.marketId);

  const connect = () => {
    if (stopped) return;
    let ws: WebSocket;
    try {
      ws = new WSImpl(wsUrl);
    } catch (err) {
      opts.onError?.(err);
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      opts.onOpen?.();
    };
    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        const parsed = JSON.parse(raw) as RawMessage;
        if (parsed.type === "tick") {
          opts.onTick?.(parseTick(parsed));
        } else if (parsed.type === "obDelta") {
          opts.onObDelta?.(parseObDelta(parsed));
        }
      } catch (err) {
        opts.onError?.(err);
      }
    };
    ws.onerror = (event: Event) => {
      opts.onError?.(event);
    };
    ws.onclose = (event: CloseEvent) => {
      socket = null;
      opts.onClose?.({ wasClean: event.wasClean, code: event.code });
      if (!stopped && !opts.noReconnect) scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = delays[Math.min(attempt, delays.length - 1)];
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
}

// ---------- parsing helpers ----------

function parseTick(raw: RawTick): Tick {
  const markE18 = safeBigInt(raw.mark);
  const bidE18 = safeBigInt(raw.bid);
  const askE18 = safeBigInt(raw.ask);
  return {
    type: "tick",
    marketId: raw.marketId,
    ts: raw.ts,
    mark: e18ToNumber(markE18),
    bid: e18ToNumber(bidE18),
    ask: e18ToNumber(askE18),
    markE18,
    bidE18,
    askE18,
    lastCandle: raw.lastCandle,
  };
}

function parseObDelta(raw: RawObDelta): ObDelta {
  return {
    type: "obDelta",
    marketId: raw.marketId,
    sequence: raw.sequence,
    bids: raw.bids.map(toObLevel),
    asks: raw.asks.map(toObLevel),
  };
}

function toObLevel([priceE18, sizeE18]: [string, string]): ObLevel {
  return {
    priceE18,
    sizeE18,
    price: e18ToNumber(safeBigInt(priceE18)),
    size: e18ToNumber(safeBigInt(sizeE18)),
  };
}

function safeBigInt(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

// Lossy-but-UI-safe: divide by 1e18 via string slicing to preserve significant
// digits when the value is large.
const E18_DIV = 1e18;
function e18ToNumber(v: bigint): number {
  if (v === 0n) return 0;
  // For typical FX/perp prices |v| < 1e25; Number can carry ~15-17 sig figs.
  return Number(v) / E18_DIV;
}

// http(s)://host  → ws(s)://host/ws/markets/:marketId
// ws(s)://host    → ws(s)://host/ws/markets/:marketId  (leave as-is)
export function buildWsUrl(baseUrl: string, marketId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  let scheme = trimmed;
  if (scheme.startsWith("http://")) scheme = "ws://" + scheme.slice("http://".length);
  else if (scheme.startsWith("https://")) scheme = "wss://" + scheme.slice("https://".length);
  return `${scheme}/ws/markets/${encodeURIComponent(marketId)}`;
}
