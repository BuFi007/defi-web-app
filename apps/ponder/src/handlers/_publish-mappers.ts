/**
 * Pure mappers — event args → publish payloads (Wave F2).
 *
 * Kept in their own module so they can be unit-tested without spinning
 * up Ponder. Handlers call these to build the realtime envelope / Tinybird
 * row, then hand the result to `publishEvent` (see ../lib/publish.ts).
 *
 * Conventions:
 *   • Tinybird columns match `tinybird/datasources/*.datasource` (PR #58).
 *     Hex addresses / hashes are lowercase. bigint amounts serialise to
 *     strings — Tinybird `Int64` accepts string-encoded integers and
 *     stays bigint-safe through JSON.
 *   • event_id = `${txHash}-${logIndex}` is the idempotency key. Replays
 *     of the same on-chain log produce identical rows so Tinybird (and any
 *     consumer doing dedupe) collapses them.
 *   • Realtime payloads serialise bigints as decimal strings — matches
 *     the `apps/api/src/lib/realtime.ts` `TradeMessage`/`FundingMessage`
 *     contracts exactly.
 *   • Timestamps: Ponder block timestamps are seconds (uint). Tinybird
 *     wants `DateTime64(3)` (ms-precision). Realtime envelopes carry
 *     unix ms. We multiply by 1000 once here so callers stay consistent.
 */

import type { TinybirdDataset } from "../lib/publish";

// ---------- shared helpers ----------

/** Lower-case a 0x-prefixed hex blob. Duplicated locally (rather than
 *  imported from `@bufi/shared-types/hex`) so the mapper file stays
 *  self-contained for unit tests — no workspace package resolution
 *  needed to run `bun test`. */
export function lowerHex(value: string): string {
  return value.toLowerCase();
}

/** Build the canonical event_id used as the Tinybird idempotency key.
 *  Matches the convention documented in PR #58's datasource files. */
export function buildEventId(txHash: string, logIndex: number): string {
  return `${lowerHex(txHash)}-${logIndex}`;
}

/** Convert block timestamp (seconds) → ms for the analytics + realtime
 *  layers. Ponder gives us a bigint; the JS Date side wants Number. We
 *  multiply in bigint space first to avoid the 2^53 cliff. */
export function blockTimestampToMs(blockTimestampSeconds: bigint): number {
  // 2^53 / 1000 ≈ year 287396 — safe to downcast after the *1000 in
  // bigint space. Guarding anyway in case of future test fixtures with
  // adversarial values.
  const ms = blockTimestampSeconds * 1000n;
  if (ms > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(ms);
}

/** Sign of an int256 size delta → long/short. Used wherever we infer the
 *  trader's side from a position event. Zero defaults to "long" — it
 *  shouldn't happen in practice (zero-size fills don't emit events). */
export function deltaSign(sizeDeltaE18: bigint): "long" | "short" {
  return sizeDeltaE18 < 0n ? "short" : "long";
}

// ---------- MatchSettled ----------

export interface MatchSettledArgs {
  marketId: string;
  maker: string;
  taker: string;
  fillSizeE18: bigint;
  fillPriceE18: bigint;
}

export interface MatchSettledMeta {
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  logIndex: number;
}

/**
 * Build the Tinybird `perp_match_settled` row.
 *
 * NOTE — partial coverage: the on-chain event carries `marketId, maker,
 * taker, fillSizeE18, fillPriceE18` only. `side`, `taker_intent_id`,
 * `maker_intent_id`, `notional_usdc`, `fee_usdc`, `taker_pnl`,
 * `maker_pnl` are NOT derivable from the event alone — they require
 * intent context that lives in the matcher keeper, not the indexer.
 * We omit those fields here; Tinybird treats missing JSON keys as
 * defaults (empty string / zero). The matcher keeper (Wave G) is the
 * authoritative publisher for the full row. Ponder's job is the
 * source-of-truth backfill / replay path.
 */
export function buildMatchSettledRow(
  args: MatchSettledArgs,
  meta: MatchSettledMeta,
): Record<string, unknown> {
  return {
    eventId: buildEventId(meta.txHash, meta.logIndex),
    chainId: meta.chainId,
    blockNumber: meta.blockNumber.toString(),
    txHash: lowerHex(meta.txHash),
    logIndex: meta.logIndex,
    marketId: lowerHex(args.marketId),
    taker: lowerHex(args.taker),
    maker: lowerHex(args.maker),
    // size_delta on `perp_match_settled` is the absolute fill size.
    // priceE18 maps to fillPriceE18.
    sizeDelta: args.fillSizeE18.toString(),
    priceE18: args.fillPriceE18.toString(),
    timestamp: blockTimestampToMs(meta.blockTimestamp),
  };
}

// ---------- PositionIncreased ----------

export interface PositionIncreasedArgs {
  marketId: string;
  trader: string;
  sizeDeltaE18: bigint;
  resultingSizeE18: bigint;
  entryPriceE18: bigint;
  marginReserved: bigint;
  fee: bigint;
}

export interface PositionDecreasedArgs {
  marketId: string;
  trader: string;
  sizeDeltaE18: bigint;
  resultingSizeE18: bigint;
  priceE18: bigint;
  marginReleased: bigint;
  pnl: bigint;
  badDebt: bigint;
}

export interface PositionEventMeta extends MatchSettledMeta {}

/** Build the `perp_position_change` row for a `PositionIncreased`. */
export function buildPositionIncreasedRow(
  args: PositionIncreasedArgs,
  meta: PositionEventMeta,
): Record<string, unknown> {
  return {
    eventId: buildEventId(meta.txHash, meta.logIndex),
    chainId: meta.chainId,
    blockNumber: meta.blockNumber.toString(),
    txHash: lowerHex(meta.txHash),
    logIndex: meta.logIndex,
    marketId: lowerHex(args.marketId),
    trader: lowerHex(args.trader),
    deltaKind: "increase",
    side: deltaSign(args.sizeDeltaE18),
    sizeDelta: args.sizeDeltaE18.toString(),
    newSize: args.resultingSizeE18.toString(),
    entryPriceE18: args.entryPriceE18.toString(),
    marginDelta: args.marginReserved.toString(),
    newMargin: args.marginReserved.toString(),
    // realizedPnl on an increase is always 0 — opening / growing a
    // position doesn't realise PnL, the close path does.
    realizedPnl: "0",
    timestamp: blockTimestampToMs(meta.blockTimestamp),
  };
}

/** Build the `perp_position_change` row for a `PositionDecreased`. */
export function buildPositionDecreasedRow(
  args: PositionDecreasedArgs,
  meta: PositionEventMeta,
): Record<string, unknown> {
  return {
    eventId: buildEventId(meta.txHash, meta.logIndex),
    chainId: meta.chainId,
    blockNumber: meta.blockNumber.toString(),
    txHash: lowerHex(meta.txHash),
    logIndex: meta.logIndex,
    marketId: lowerHex(args.marketId),
    trader: lowerHex(args.trader),
    deltaKind: "decrease",
    // On a decrease the sign of sizeDelta reflects the closing direction
    // (closing a long → sizeDelta < 0). We invert so `side` answers
    // "what side did the trader hold going into the close?".
    side: args.sizeDeltaE18 < 0n ? "long" : "short",
    sizeDelta: args.sizeDeltaE18.toString(),
    newSize: args.resultingSizeE18.toString(),
    entryPriceE18: args.priceE18.toString(),
    marginDelta: args.marginReleased.toString(),
    // newMargin on a decrease isn't directly in the event — we know the
    // delta. Set it equal to the delta and let the read pipe derive the
    // running balance from the increase + decrease stream.
    newMargin: args.marginReleased.toString(),
    realizedPnl: args.pnl.toString(),
    timestamp: blockTimestampToMs(meta.blockTimestamp),
  };
}

// ---------- realtime payload builder (currently unused at the Ponder
// layer — the matcher keeper is the authoritative `trades:` publisher
// because it has the full intent context including `side`. Kept here
// for the day Ponder also publishes realtime — e.g., a stream-replay
// mode. Tests exercise it so the contract stays warm.) ----------

export interface BuildTradeMessageInput {
  fillPriceE18: bigint;
  fillSizeE18: bigint;
  side: "long" | "short";
  txHash: string;
  taker: string;
  blockTimestamp: bigint;
}

/** Build a `TradeMessage` payload (PR #56 contract). Bigint fields go
 *  out as decimal strings — matches the realtime lib's wire shape. */
export function buildTradeMessage(input: BuildTradeMessageInput): Record<string, unknown> {
  return {
    priceE18: input.fillPriceE18.toString(),
    sizeE18: input.fillSizeE18.toString(),
    side: input.side,
    txHash: lowerHex(input.txHash),
    taker: lowerHex(input.taker),
    ts: blockTimestampToMs(input.blockTimestamp),
  };
}

// ---------- FundingPoked (Wave I1) ----------

export interface FundingPokedArgs {
  marketId: string;
  version: bigint;
  rateE18PerSecond: bigint;
  cumulativeFundingE18: bigint;
}

export interface FundingPokedMeta extends MatchSettledMeta {}

/** Build the Tinybird `perp_funding_poked` row. Columns match the
 *  datasource shipped in PR #58 (snake_case at the wire — `apps/api`
 *  ingest route forwards the row unchanged). */
export function buildFundingPokedRow(
  args: FundingPokedArgs,
  meta: FundingPokedMeta,
): Record<string, unknown> {
  return {
    event_id: buildEventId(meta.txHash, meta.logIndex),
    market_id: lowerHex(args.marketId),
    version: args.version.toString(),
    rate_e18_per_second: args.rateE18PerSecond.toString(),
    cumulative_funding_e18: args.cumulativeFundingE18.toString(),
    chain_id: meta.chainId,
    tx_hash: lowerHex(meta.txHash),
    block_number: meta.blockNumber.toString(),
    timestamp: new Date(blockTimestampToMs(meta.blockTimestamp)).toISOString(),
  };
}

/** Build the realtime `funding:` channel payload — matches the
 *  `FundingMessage` contract documented in `apps/api/src/lib/realtime.ts`.
 *  `markE18` is "0" because FundingPoked doesn't carry the mark price;
 *  downstream consumers join with the oracle stream when they need it. */
export function buildFundingMessage(
  args: FundingPokedArgs,
  meta: FundingPokedMeta,
): { rateE18: string; markE18: string; ts: number } {
  return {
    rateE18: args.rateE18PerSecond.toString(),
    markE18: "0",
    ts: blockTimestampToMs(meta.blockTimestamp),
  };
}

// ---------- AccountLiquidated (Wave I1) ----------

export interface AccountLiquidatedArgs {
  marketId: string;
  trader: string;
  liquidator: string;
  reward: bigint;
  socializedLoss: bigint;
}

export interface AccountLiquidatedMeta extends MatchSettledMeta {}

/** Build the Tinybird `perp_liquidation` row. */
export function buildAccountLiquidatedRow(
  args: AccountLiquidatedArgs,
  meta: AccountLiquidatedMeta,
): Record<string, unknown> {
  return {
    event_id: buildEventId(meta.txHash, meta.logIndex),
    market_id: lowerHex(args.marketId),
    trader: lowerHex(args.trader),
    liquidator: lowerHex(args.liquidator),
    reward_atomic: args.reward.toString(),
    socialized_loss_atomic: args.socializedLoss.toString(),
    chain_id: meta.chainId,
    tx_hash: lowerHex(meta.txHash),
    block_number: meta.blockNumber.toString(),
    timestamp: new Date(blockTimestampToMs(meta.blockTimestamp)).toISOString(),
  };
}

// ---------- AccountFlagged (Wave I1) ----------
//
// Realtime + Tinybird are intentionally NOT wired here — flag events are
// operational signals (keepers raising the flag, contract auto-clearing
// on liquidate) and the indexer DB row is sufficient to surface them. If
// a flag_events analytics dataset lands later, the row builder will live
// next to these others.

export interface AccountFlaggedArgs {
  marketId: string;
  trader: string;
  flagger: string;
}

export interface AccountFlaggedMeta extends MatchSettledMeta {}

/** Build the indexer DB row for AccountFlagged. Returned as a plain
 *  object so unit tests can assert the shape without spinning Ponder. */
export function buildAccountFlaggedRow(
  args: AccountFlaggedArgs,
  meta: AccountFlaggedMeta,
): Record<string, unknown> {
  return {
    id: buildEventId(meta.txHash, meta.logIndex),
    chainId: meta.chainId,
    marketId: lowerHex(args.marketId),
    trader: lowerHex(args.trader),
    state: "flagged",
    actor: lowerHex(args.flagger),
    auto: null,
    blockNumber: meta.blockNumber,
    blockTimestamp: meta.blockTimestamp,
    txHash: lowerHex(meta.txHash),
    logIndex: meta.logIndex,
  };
}

// ---------- dataset enum guard ----------

/** Type-level reminder that the four allowed datasets line up with
 *  the writer route's enum (PR #58). Compile-time guard only. */
const _DATASET_PROOF: Record<TinybirdDataset, true> = {
  perp_match_settled: true,
  perp_position_change: true,
  perp_funding_poked: true,
  perp_liquidation: true,
};
void _DATASET_PROOF;
