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
 * SOURCE OF TRUTH:
 *  - `tick.mark` / `bid` / `ask` are sourced from Pyth Hermes when the
 *    incoming `:marketId` can be mapped to a Pyth feed id. Otherwise we fall
 *    back to the deterministic mock so the scaffold never goes silent.
 *  - `obDelta` is still mock-only — the on-chain order book lands in Sprint E.
 *
 * ENV:
 *  - `HERMES_BASE_URL` — overrides the default `HERMES_DEFAULT_BASE_URL`
 *    (`https://hermes.pyth.network`) used by `streamPythPrice`.
 *
 * MARKET-ID → PYTH FEED MAPPING:
 *  `pythFeedForSpotSymbol` from `@bufi/market-data` only accepts the spot
 *  symbol literals ("EURC" | "JPYC" | "MXNB"), so we wrap it with
 *  `resolvePythFeed(marketId)` below that accepts the looser identifiers
 *  flowing through the WS scaffold ("EUR/USD", "EURUSD", "EUR-USD-PERP",
 *  "tEURC/USDC", etc.) and normalises them to either a SpotFxSymbol or a
 *  direct `PYTH_FEED_IDS` entry. Anything unrecognised returns `null` and
 *  the connection stays on the mock generator.
 *
 * TODO(sprint-e): rate-limit per-IP and per-marketId; auth optional for L2
 *   private feeds (e.g. user-scoped position updates).
 */
import type { ServerWebSocket } from "bun";
import type { Hex } from "viem";

import { PYTH_FEED_IDS, type SpotFxSymbol } from "@bufi/contracts";
import {
  pythFeedForSpotSymbol,
  streamPythPrice,
  type PythStreamTick,
  type UnsubscribePythStream,
} from "@bufi/market-data";

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
  /** Live Pyth subscription teardown — null when on mock fallback. */
  pythUnsubscribe?: UnsubscribePythStream | null;
  /** Resolved Pyth feed id for this market, or null when none mapped. */
  pythFeedId?: Hex | null;
  // Soft log surface — bound via server.ts on upgrade so we don't pull the
  // logger module into the public path. We accept any Logger shape with an
  // `info` method (matches both @bufinance/logger and @bufi/logger).
  log?: {
    info: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
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
const E18_NUM = 1e18;

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
  rollCandleIfNeeded(ctx, mark);
  return {
    type: "tick",
    marketId: ctx.marketId,
    ts: Date.now(),
    mark: toE18String(mark),
    bid: toE18String(bid),
    ask: toE18String(ask),
    lastCandle: snapshotLastCandle(ctx, mark),
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

// Shared candle bookkeeping so the Pyth and mock paths agree on bucketing.
function rollCandleIfNeeded(ctx: WsCtx, mark: number): void {
  ctx.candle.c = mark;
  ctx.candle.h = Math.max(ctx.candle.h, mark);
  ctx.candle.l = Math.min(ctx.candle.l, mark);
  ctx.candle.v += nextRand(ctx) * 5;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - ctx.candleStart >= CANDLE_SECONDS) {
    ctx.candleStart = nowSec;
    ctx.candle = { o: mark, h: mark, l: mark, c: mark, v: 0 };
  }
}

function snapshotLastCandle(ctx: WsCtx, mark: number): TickMessage["lastCandle"] {
  return {
    time: ctx.candleStart,
    o: round4(ctx.candle.o),
    h: round4(ctx.candle.h),
    l: round4(ctx.candle.l),
    c: round4(mark),
    v: Math.round(ctx.candle.v),
  };
}

// ---------- marketId → Pyth feed id resolution ----------
//
// We accept whatever loose identifier the WS client provides and try to map
// it to a known Pyth feed. The canonical helper `pythFeedForSpotSymbol` only
// accepts SpotFxSymbol literals, so this wrapper does the broader matching.
const SPOT_FX_SYMBOLS: ReadonlyArray<SpotFxSymbol> = ["EURC", "JPYC", "MXNB"];

export function resolvePythFeed(marketId: string): Hex | null {
  const upper = marketId.toUpperCase();

  // 1) Direct SpotFxSymbol match — e.g. "EURC", "JPYC".
  for (const sym of SPOT_FX_SYMBOLS) {
    if (upper === sym) return pythFeedForSpotSymbol(sym);
  }

  // 2) Substring-based heuristic. Order matters — check more specific tokens
  //    before generic three-letter codes so "JPYC/USDC" maps before "JPY".
  if (upper.includes("EURC") || upper.includes("EUR")) return PYTH_FEED_IDS.eurUsd;
  if (upper.includes("JPYC") || upper.includes("JPY")) return PYTH_FEED_IDS.jpyUsd;
  if (upper.includes("MXNB") || upper.includes("MXN")) return PYTH_FEED_IDS.mxnUsd;
  if (upper.includes("CIRBTC") || upper.includes("BTC")) return PYTH_FEED_IDS.btcUsd;
  if (upper.includes("QCAD") || upper.includes("CAD")) return PYTH_FEED_IDS.cadUsd;
  if (upper.includes("AUDF") || upper.includes("AUD")) return PYTH_FEED_IDS.audUsd;
  if (upper.includes("CHFC") || upper.includes("CHF")) return PYTH_FEED_IDS.chfUsd;

  return null;
}

// ---------- E18 bigint → JS number (lossy, UI-only) ----------
function e18BigIntToNumber(v: bigint): number {
  if (v === 0n) return 0;
  // Typical FX prices fit in Number precision; this preserves ~15 sig figs.
  return Number(v) / E18_NUM;
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
    pythUnsubscribe: null,
    pythFeedId: resolvePythFeed(args.marketId),
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
    ctx.log?.info("ws_open", { marketId: ctx.marketId, pythFeedId: ctx.pythFeedId ?? null });

    const startMockTicks = () => {
      if (ctx.tickTimer) return;
      ctx.tickTimer = setInterval(() => {
        try {
          ws.send(JSON.stringify(buildTick(ctx)));
        } catch {
          // socket closed mid-send; cleanup runs in close().
        }
      }, 1000);
    };

    if (ctx.pythFeedId) {
      // Real Pyth path. On every Hermes tick we update internal candle state
      // and push the same envelope clients already understand. Bid/ask are
      // derived from the Pyth confidence interval as a stand-in for an order
      // book spread until Sprint E ships the real book.
      try {
        ctx.pythUnsubscribe = streamPythPrice({
          feedId: ctx.pythFeedId,
          onPrice: (tick: PythStreamTick) => {
            try {
              const mark = e18BigIntToNumber(tick.priceE18);
              const conf = e18BigIntToNumber(tick.confE18);
              if (!Number.isFinite(mark) || mark <= 0) return;
              rollCandleIfNeeded(ctx, mark);
              const bid = Math.max(0, mark - conf);
              const ask = mark + conf;
              const msg: TickMessage = {
                type: "tick",
                marketId: ctx.marketId,
                ts: Date.now(),
                mark: tick.priceE18.toString(),
                bid: toE18String(bid),
                ask: toE18String(ask),
                lastCandle: snapshotLastCandle(ctx, mark),
              };
              try {
                ws.send(JSON.stringify(msg));
              } catch {
                // socket closed mid-send; close() handles teardown.
              }
            } catch (err) {
              ctx.log?.warn?.("ws_pyth_emit_error", {
                marketId: ctx.marketId,
                err: (err as Error).message,
              });
            }
          },
          onError: (err) => {
            ctx.log?.warn?.("ws_pyth_stream_error", {
              marketId: ctx.marketId,
              feedId: ctx.pythFeedId,
              err: err instanceof Error ? err.message : String(err),
            });
            // Stream client handles its own SSE→poll fallback + reconnect.
            // We additionally engage the mock generator so the socket keeps
            // producing frames for the UI even if Hermes is fully down.
            startMockTicks();
          },
        });
      } catch (err) {
        ctx.log?.error?.("ws_pyth_subscribe_failed", {
          marketId: ctx.marketId,
          feedId: ctx.pythFeedId,
          err: (err as Error).message,
        });
        startMockTicks();
      }
    } else {
      ctx.log?.info("ws_pyth_unmapped_fallback_mock", { marketId: ctx.marketId });
      startMockTicks();
    }

    // OB delta every 250ms (mock — Sprint E swaps this for on-chain book).
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
    if (ctx.pythUnsubscribe) {
      try {
        ctx.pythUnsubscribe();
      } catch {
        // ignore
      }
      ctx.pythUnsubscribe = null;
    }
    ctx.log?.info("ws_close", { marketId: ctx.marketId, sequence: ctx.sequence });
  },
};

// Helper used by server.ts to extract `:marketId` from a request URL. Returns
// null if the path doesn't match — caller falls through to Hono.
//
// Must handle BOTH encoded and decoded slashes in the market-id segment:
//   - `/ws/markets/EUR%2FUSD`  → `"EUR/USD"`  (browser sends %2F)
//   - `/ws/markets/EUR/USD`    → `"EUR/USD"`  (reverse proxy decoded %2F)
//
// Railway (and many other reverse proxies) decode percent-encoded path
// separators before forwarding to the backend, so the second form appears
// in production even though the browser originally sent the first.
export function parseMarketsWsPath(pathname: string): string | null {
  if (!pathname.startsWith(WS_MARKETS_PATH)) return null;
  const rest = pathname.slice(WS_MARKETS_PATH.length);
  if (!rest || rest.length > 64) return null;
  // Decode first (handles %2F → /) then validate. The decoded id may contain
  // `/` (e.g. "EUR/USD") — that's a valid market identifier in this codebase.
  // We reject empty segments ("//"), leading/trailing slashes, and path
  // traversal patterns ("..") to stay safe.
  const decoded = decodeURIComponent(rest);
  if (
    !decoded ||
    decoded.includes("..") ||
    decoded.startsWith("/") ||
    decoded.endsWith("/") ||
    decoded.includes("//")
  ) {
    return null;
  }
  return decoded;
}

// Re-export E18 constant for unit tests / downstream tooling.
export { E18 as WS_E18_SCALE };
