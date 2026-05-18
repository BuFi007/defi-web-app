/**
 * Live-market WebSocket scaffold — Bucket #5 (Sprint D bridge).
 *
 * This module is intentionally framework-agnostic at the wire level: the Hono
 * app delegates the HTTP-upgrade decision here and exposes a `websocket`
 * handler object suitable for Bun.serve's default-export shape.
 *
 * Wire format (JSON, one message per frame). All bigint fields are encoded as
 * decimal strings (E18 unless noted) so JavaScript parsers don't silently
 * truncate large values.
 *
 *   { type: 'tick', marketId, ts, mark, bid, ask, lastCandle }
 *   { type: 'obDelta', marketId, sequence, bids, asks }
 *
 * SCAFFOLD ONLY — real Pyth + on-chain orderbook wiring lands in Sprint E.
 * TODO(sprint-e): rate-limit per-IP and per-marketId; auth optional for L2
 *   private feeds (e.g. user-scoped position updates).
 */
import type { ServerWebSocket } from "bun";

// Path prefix the Hono server uses to test for ws upgrade candidates. Mounted
// under /ws/markets/:marketId — `app.route("/ws", ...)` is unnecessary because
// the upgrade decision happens before Hono routing in server.ts.
export const WS_MARKETS_PATH = "/ws/markets/";

// ---------- types on the wire ----------

export interface TickMessage {
  type: "tick";
  marketId: string;
  /** Server-side unix ms. Clients should treat this as authoritative. */
  ts: number;
  /** Mark price as decimal string (E18). */
  mark: string;
  /** Best bid as decimal string (E18). */
  bid: string;
  /** Best ask as decimal string (E18). */
  ask: string;
  /** Live partial candle: same shape as `@bufi/market-data` `Candle` but with
   *  `time` in seconds (UTCTimestamp) and price fields as numbers (charts
   *  need numbers — bigint precision isn't useful at 4-decimal UI display). */
  lastCandle: {
    time: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  };
}

export interface ObDeltaMessage {
  type: "obDelta";
  marketId: string;
  /** Monotonic per-connection. Clients drop out-of-order frames. */
  sequence: number;
  /** Up to 5 levels each side, `[priceE18, sizeE18]` as decimal strings. */
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

export type MarketsWsMessage = TickMessage | ObDeltaMessage;

// ---------- per-connection state ----------

interface WsCtx {
  marketId: string;
  basePrice: number;
  seed: number;
  sequence: number;
  candleStart: number;
  candle: { o: number; h: number; l: number; c: number; v: number };
  tickTimer?: ReturnType<typeof setInterval>;
  obTimer?: ReturnType<typeof setInterval>;
  // Soft log surface — bound via server.ts on upgrade so we don't pull the
  // logger module into the public path. We accept any Logger shape with an
  // `info` method (matches both @bufinance/logger and @bufi/logger).
  log?: { info: (...args: unknown[]) => void };
}

// Bun typing for ws data is generic; we keep the cast contained here.
type MarketsWs = ServerWebSocket<WsCtx>;

// ---------- deterministic mock generator ----------
// Mirrors the seed pattern in @bufi/market-data `makeMockCandles` so the live
// scaffold visually agrees with the historical/seed candles already rendered.

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function nextRand(ctx: WsCtx): number {
  ctx.seed = (ctx.seed * 9301 + 49297) % 233280;
  return ctx.seed / 233280;
}

const CANDLE_SECONDS = 15; // matches a 15s rolling micro-candle for the scaffold
const E18 = 10n ** 18n;

function toE18String(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  // Avoid float drift past 6 significant digits — multiply, round, then BigInt.
  const scaled = BigInt(Math.round(n * 1e9));
  // n * 1e9 → result is E9; bring up to E18.
  return (scaled * 10n ** 9n).toString();
}

function buildTick(ctx: WsCtx): TickMessage {
  const drift = (nextRand(ctx) - 0.5) * ctx.basePrice * 0.0008;
  const mark = Math.max(ctx.basePrice * 0.5, ctx.candle.c + drift);
  const spread = ctx.basePrice * 0.0006;
  const bid = mark - spread / 2;
  const ask = mark + spread / 2;
  ctx.candle.c = mark;
  ctx.candle.h = Math.max(ctx.candle.h, mark);
  ctx.candle.l = Math.min(ctx.candle.l, mark);
  ctx.candle.v += nextRand(ctx) * 5;
  // Roll the candle bucket every CANDLE_SECONDS so the chart sees a fresh
  // partial bar instead of an unbounded one.
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - ctx.candleStart >= CANDLE_SECONDS) {
    ctx.candleStart = nowSec;
    ctx.candle = { o: mark, h: mark, l: mark, c: mark, v: 0 };
  }
  return {
    type: "tick",
    marketId: ctx.marketId,
    ts: Date.now(),
    mark: toE18String(mark),
    bid: toE18String(bid),
    ask: toE18String(ask),
    lastCandle: {
      time: ctx.candleStart,
      o: round4(ctx.candle.o),
      h: round4(ctx.candle.h),
      l: round4(ctx.candle.l),
      c: round4(mark),
      v: Math.round(ctx.candle.v),
    },
  };
}

function buildObDelta(ctx: WsCtx): ObDeltaMessage {
  ctx.sequence += 1;
  const mid = ctx.candle.c;
  const tick = Math.max(ctx.basePrice * 0.0002, 1e-6);
  const bids: Array<[string, string]> = [];
  const asks: Array<[string, string]> = [];
  for (let i = 1; i <= 5; i++) {
    const bp = mid - tick * i;
    const ap = mid + tick * i;
    const bs = 50 + nextRand(ctx) * 250;
    const as = 50 + nextRand(ctx) * 250;
    bids.push([toE18String(bp), toE18String(bs)]);
    asks.push([toE18String(ap), toE18String(as)]);
  }
  return {
    type: "obDelta",
    marketId: ctx.marketId,
    sequence: ctx.sequence,
    bids,
    asks,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------- upgrade entry ----------

export interface UpgradeArgs {
  /** Parsed from URL — `/ws/markets/EURUSD` → `'EURUSD'`. */
  marketId: string;
  /** Optional logger forwarded from request-scoped middleware. */
  log?: WsCtx["log"];
  /** Optional seed price — useful for tests; defaults to a per-market hash. */
  basePrice?: number;
}

export function makeUpgradeData(args: UpgradeArgs): WsCtx {
  const base = args.basePrice ?? deriveBasePrice(args.marketId);
  const seed = Math.abs(hashString(args.marketId)) || Math.floor(base * 1000) || 1;
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    marketId: args.marketId,
    basePrice: base,
    seed,
    sequence: 0,
    candleStart: nowSec,
    candle: { o: base, h: base, l: base, c: base, v: 0 },
    log: args.log,
  };
}

function deriveBasePrice(marketId: string): number {
  // Cheap deterministic price derivation. Keeps EUR/USD-ish pairs near 1, and
  // BTC-ish ids near 50k. The scaffold doesn't care about correctness —
  // only that the stream is non-static.
  const upper = marketId.toUpperCase();
  if (upper.includes("BTC")) return 65000;
  if (upper.includes("ETH")) return 3200;
  if (upper.includes("SOL")) return 150;
  if (upper.includes("JPY")) return 0.0067;
  if (upper.includes("MXN")) return 0.057;
  if (upper.includes("CHF")) return 1.12;
  return 1.08; // EUR/USD-ish default
}

// ---------- Bun websocket handler ----------

export const marketsWebSocketHandler = {
  open(ws: MarketsWs) {
    const ctx = ws.data;
    ctx.log?.info("ws_open", { marketId: ctx.marketId });
    // Tick every 1000ms.
    ctx.tickTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify(buildTick(ctx)));
      } catch {
        // socket closed mid-send; cleanup runs in close().
      }
    }, 1000);
    // OB delta every 250ms.
    ctx.obTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify(buildObDelta(ctx)));
      } catch {
        // ignore — close handler clears timers.
      }
    }, 250);
  },
  message(_ws: MarketsWs, _msg: string | Buffer) {
    // No client→server messages in scaffold. Future: subscribe to specific
    // streams (trades, funding, liquidations) via a control envelope.
  },
  close(ws: MarketsWs) {
    const ctx = ws.data;
    if (ctx.tickTimer) clearInterval(ctx.tickTimer);
    if (ctx.obTimer) clearInterval(ctx.obTimer);
    ctx.log?.info("ws_close", { marketId: ctx.marketId, sequence: ctx.sequence });
  },
};

// Helper used by server.ts to extract `:marketId` from a request URL. Returns
// null if the path doesn't match — caller falls through to Hono.
export function parseMarketsWsPath(pathname: string): string | null {
  if (!pathname.startsWith(WS_MARKETS_PATH)) return null;
  const rest = pathname.slice(WS_MARKETS_PATH.length);
  // Reject sub-paths / empty / suspicious chars. Market ids in this codebase
  // are short symbols (e.g. EUR-USD-PERP). Cap at 64 chars.
  if (!rest || rest.length > 64 || rest.includes("/")) return null;
  return decodeURIComponent(rest);
}
