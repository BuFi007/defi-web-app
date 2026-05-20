// Keeper-side publish payload mappers. Mirrors the Ponder F2 mapper-shape
// convention (pure functions, decoded-event-args in, envelope out) so the
// matcher / funding / liquidator publish call-sites stay one-liners and
// the row construction is unit-testable without spinning up a chain.
//
// IMPORTANT: this is NOT the Ponder-side mapper. Ponder's `_publish-mappers`
// (F2) lives under `apps/ponder/src/`. Keepers publish from their own
// fire-and-forget loop, so they need their own decoded-args ➜ envelope
// mappers. Keep both shapes aligned — the Tinybird dataset rows are the
// same schema either way, so a downstream consumer can't tell whether the
// row came from a keeper or from the Ponder indexer reorg-safe path.
//
// Conventions:
//   - All bigint fields are stringified at the row level so JSON serialise
//     is lossless. `postPublish` also has a bigint replacer as a fallback.
//   - `event_id` is `${txHash}-${logIndex}` so retries (e.g. Tinybird ingest
//     retry, a reorg producing the same logical event) dedupe on the
//     downstream side. Matches the matcher's `${hash}:${matchLogIndex}` shape.
//   - `block_number` is coerced to Number — Tinybird's `UInt64` accepts that
//     up to 2^53; Arc block heights are nowhere near.

import type { PublishEnvelope } from "./publish";

/** Decoded args from the `FundingPoked` event on FxFundingEngine. */
export interface FundingPokedArgs {
  marketId: `0x${string}`;
  version: bigint;
  rateE18PerSecond: bigint;
  cumulativeFundingE18: bigint;
}

export interface FundingPokedMeta {
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Index of the FundingPoked log within the receipt. Used for event_id. */
  logIndex: number;
}

/**
 * Build a publish envelope for a `FundingPoked` event.
 *
 * Realtime channel: `funding:${marketId}` so the trade tape + market dashboards
 * can subscribe per-market. Payload carries the per-second rate (E18 scaled
 * signed int) so clients can render funding without re-reading the chain.
 *
 * Analytics row matches the `perp_funding_poked` Tinybird datasource.
 */
export function mapFundingPokedToPublish(
  args: FundingPokedArgs,
  meta: FundingPokedMeta,
): PublishEnvelope {
  return {
    realtime: {
      channel: `funding:${args.marketId}`,
      payload: {
        rateE18: args.rateE18PerSecond.toString(),
        cumulativeFundingE18: args.cumulativeFundingE18.toString(),
        version: args.version.toString(),
        txHash: meta.txHash,
        ts: Date.now(),
      },
    },
    analytics: {
      dataset: "perp_funding_poked",
      row: {
        event_id: `${meta.txHash}-${meta.logIndex}`,
        market_id: args.marketId,
        rate_e18: args.rateE18PerSecond.toString(),
        cumulative_funding_e18: args.cumulativeFundingE18.toString(),
        version: args.version.toString(),
        tx_hash: meta.txHash,
        block_number: Number(meta.blockNumber),
        timestamp: new Date().toISOString(),
      },
    },
  };
}

/** Decoded args from the `AccountLiquidated` event on FxLiquidationEngine. */
export interface AccountLiquidatedArgs {
  marketId: `0x${string}`;
  trader: `0x${string}`;
  liquidator: `0x${string}`;
  reward: bigint;
  socializedLoss: bigint;
}

export interface AccountLiquidatedMeta {
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Index of the AccountLiquidated log within the receipt. Used for event_id. */
  logIndex: number;
}

/**
 * Build a publish envelope for an `AccountLiquidated` event.
 *
 * No realtime channel in v1 — liquidations are low-frequency and matcher's
 * `trades:${marketId}` channel already carries the resulting position
 * close. Analytics row matches the `perp_liquidation` Tinybird datasource.
 */
export function mapAccountLiquidatedToPublish(
  args: AccountLiquidatedArgs,
  meta: AccountLiquidatedMeta,
): PublishEnvelope {
  return {
    analytics: {
      dataset: "perp_liquidation",
      row: {
        event_id: `${meta.txHash}-${meta.logIndex}`,
        market_id: args.marketId,
        liquidator: args.liquidator,
        trader: args.trader,
        reward_atomic: args.reward.toString(),
        socialized_loss_atomic: args.socializedLoss.toString(),
        tx_hash: meta.txHash,
        block_number: Number(meta.blockNumber),
        timestamp: new Date().toISOString(),
      },
    },
  };
}
