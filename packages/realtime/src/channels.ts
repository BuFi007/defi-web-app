/**
 * Realtime channel naming + JSON message schemas for the Bun WS + Redis
 * pub/sub fan-out (Wave E6 — Pillar 4 + 10) and the matcher intent-notify
 * stream (Wave H1).
 *
 * Originally landed in `apps/api/src/lib/realtime.ts` (PR #56). Extracted
 * into `@bufi/realtime/channels` so cross-process callers (matcher, future
 * keepers) share the channel-name + envelope contract without dragging in
 * apps/api. apps/api re-exports from here verbatim — Wave H1.
 *
 * One marketId fans out across three channels:
 *
 *   trades:<marketId>    settled fills (taker/maker pair, price, size, side)
 *   book:<marketId>      orderbook deltas (pending intents repackaged)
 *   funding:<marketId>   funding-rate updates from FundingPoked
 *
 * Wave H1 adds one *global* matcher-driven channel:
 *
 *   perps:intent:inserted   payload-carries-marketId notify after store.put
 *
 * The wire shape is intentionally generic: a thin envelope plus a
 * channel-specific `data` payload. WS clients receive the same envelope so
 * the message router on the consumer side is a single switch on `channel`.
 *
 * NOTE: bigint fields are encoded as decimal strings (E18 unless noted) so
 * JSON parsers don't silently truncate. Mirrors the convention in
 * `apps/api/src/routes/ws.ts` and `packages/market-data/src/ws.ts`.
 */

export type RealtimeChannelKind = "trades" | "book" | "funding";

export const REALTIME_CHANNEL_KINDS: ReadonlyArray<RealtimeChannelKind> = [
  "trades",
  "book",
  "funding",
];

/**
 * Build the channel name for a (kind, marketId) pair. Use this everywhere
 * instead of string-concatenating ad-hoc — keeps the naming convention in
 * one place so future re-shards (`v2:trades:<marketId>`) are a one-line edit.
 */
export function realtimeChannel(
  kind: RealtimeChannelKind,
  marketId: string,
): string {
  return `${kind}:${marketId}`;
}

/**
 * Reverse of `realtimeChannel`. Returns `null` if the name doesn't match the
 * `<kind>:<marketId>` shape — caller must treat this as a hard validation
 * failure (channels with unrecognised kinds get dropped, not forwarded).
 */
export function parseRealtimeChannel(
  channel: string,
): { kind: RealtimeChannelKind; marketId: string } | null {
  const idx = channel.indexOf(":");
  if (idx <= 0 || idx === channel.length - 1) return null;
  const kindCandidate = channel.slice(0, idx);
  const marketId = channel.slice(idx + 1);
  if (!REALTIME_CHANNEL_KINDS.includes(kindCandidate as RealtimeChannelKind)) {
    return null;
  }
  return { kind: kindCandidate as RealtimeChannelKind, marketId };
}

// ---------- channel payload schemas ----------

/**
 * Settled trade fill. Published from the matcher / settlement path after the
 * `settleMatch` tx confirms. Consumer renders a trade tape and updates
 * 24h-volume / last-price displays in real time.
 */
export interface TradeMessage {
  /** Fill price as decimal string (E18). */
  priceE18: string;
  /** Fill size as decimal string (E18). Positive = taker bought. */
  sizeE18: string;
  /** Taker side as the perceived direction of the fill. */
  side: "long" | "short";
  /** Optional settlement tx hash for cross-linking with the explorer. */
  txHash?: string;
  /** Optional taker address (lowercase 0x...). */
  taker?: string;
  /** Server-side unix ms. */
  ts: number;
}

/**
 * Orderbook delta — top-N levels per side. We push the FULL top-N on each
 * update for simplicity; clients replace state wholesale. Diff-encoding can
 * be added later by bumping the channel name to `book.v2:<marketId>`.
 */
export interface BookMessage {
  /** Monotonic per-channel sequence. Clients drop out-of-order frames. */
  sequence: number;
  /** `[priceE18, sizeE18]` decimal-string pairs, best-first. */
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  /** Server-side unix ms. */
  ts: number;
}

/**
 * Funding-rate update. Emitted from `FundingPoked` events (or analogous
 * periodic re-quotes from the keeper). `rateE18` is the per-interval funding
 * rate; consumer multiplies by interval count to project annualised numbers.
 */
export interface FundingMessage {
  /** Per-interval funding rate as decimal string (E18, can be negative). */
  rateE18: string;
  /** Mark price at the moment of the funding update. */
  markE18: string;
  /** Server-side unix ms. */
  ts: number;
}

export type RealtimePayload = TradeMessage | BookMessage | FundingMessage;

/**
 * Envelope every WS client sees. Wraps the channel-specific `data` payload
 * with the channel name + marketId so the client router can demux without
 * re-parsing the channel name.
 */
export interface RealtimeEnvelope<T extends RealtimePayload = RealtimePayload> {
  type: "realtime";
  channel: string;
  kind: RealtimeChannelKind;
  marketId: string;
  data: T;
}

/**
 * Trade-tape / book / funding consumers can narrow on `kind` to get the
 * right payload shape. Caller does:
 *   if (env.kind === "trades") { const t = env.data as TradeMessage; ... }
 */
export function buildEnvelope<T extends RealtimePayload>(
  kind: RealtimeChannelKind,
  marketId: string,
  data: T,
): RealtimeEnvelope<T> {
  return {
    type: "realtime",
    channel: realtimeChannel(kind, marketId),
    kind,
    marketId,
    data,
  };
}

// ---------- Wave H1: matcher-driven channels ----------

/**
 * Single global channel notifying when a perps intent has just been
 * persisted by `apps/api`. The matcher subscribes and runs an early
 * match attempt; without it the matcher waits up to `KEEPER_POLL_MS`
 * (~30s) before noticing the intent.
 *
 * One channel for ALL markets — payload carries the marketId. Multiplexing
 * by market on the broker would explode subscription state for no
 * meaningful win (matcher needs to scan every market on every notify
 * anyway because cross-intent matches are global).
 */
export const PERPS_INTENT_INSERTED_CHANNEL = "perps:intent:inserted";

/**
 * Payload shape published on `perps:intent:inserted`. The matcher reads
 * the full PerpIntent row from SQLite using `intentId` — the payload only
 * carries enough metadata for ergonomic logging + an optional `side` hint
 * for instrumentation. The reverse lookup is the source of truth (the
 * notify is a wake-up, not a state transfer).
 */
export interface PerpsIntentInsertedMessage {
  /** PerpIntent.intentId — the EIP-712 digest. Used to fetch the full row. */
  intentId: string;
  /** Hex marketId the intent targets (same shape as PerpIntent.marketId). */
  marketId: string;
  /** Chain the intent was submitted on. */
  chainId: number;
  /**
   * Trader-perceived side. `unknown` when the caller can't cheaply derive
   * it (e.g. for a replacement intent that flips sign). The matcher
   * doesn't depend on this field; it's instrumentation only.
   */
  side: "long" | "short" | "unknown";
  /** Unix ms at the moment of insert. Used to measure end-to-end notify latency. */
  insertedAt: number;
}
