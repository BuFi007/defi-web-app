/**
 * FxMarketRegistry + FxLiquidationEngine event handlers.
 *
 * The registry is a single-surface router over Morpho Blue isolated markets
 * (see /Users/criptopoeta/coding-dojo/fx-telarana/contracts/src/hub/
 * FxMarketRegistry.sol). Subscribed events:
 *   • MarketRegistered(marketId, loanToken, collateralToken, irm, lltv)
 *       → lendingMarket upsert (status='registered', isLive=false until
 *         PoolLiveSet flips it on)
 *   • PoolLiveSet(marketId, isLive)        → lendingMarket isLive flag
 *   • BorrowDelegateSet(account, delegate, allowed) → borrowDelegate upsert
 *
 * Wave I1 adds the FxLiquidationEngine surface (perp-account lifecycle):
 *   • AccountFlagged(marketId, trader, flagger) → perpAccountFlag insert
 *   • AccountLiquidated(marketId, trader, liquidator, reward,
 *     socializedLoss) → perpLiquidation insert + Tinybird publish
 *   • AccountFlagRescinded is NOT emitted by the current contract — the
 *     `liquidate()` path auto-deletes the flag without an event. If that
 *     changes upstream, add the rescinded handler accordingly.
 *
 * Naming convention follows perps.ts / telarana.ts: lowerHex everything,
 * use `${txHash}-${logIndex}` (or the chain-side dedupe key when one
 * exists) for append rows, and let `onConflictDoNothing` /
 * `onConflictDoUpdate` handle the lifecycle transitions.
 */
import { ponder } from "ponder:registry";
import {
  borrowDelegate,
  lendingMarket,
  perpAccountFlag,
  perpLiquidation,
} from "ponder:schema";
import type { Hex } from "viem";

import { lowerHex } from "@bufi/shared-types/hex";

import {
  buildAccountFlaggedRow,
  buildAccountLiquidatedRow,
} from "./_publish-mappers";
import { publishEvent } from "../lib/publish";

ponder.on("FxMarketRegistryArc:MarketRegistered", async ({ event, context }) => {
  const marketIdValue = lowerHex(event.args.marketId);
  const row = {
    marketId: marketIdValue,
    chainId: context.chain.id,
    loanToken: lowerHex(event.args.loanToken),
    collateralToken: lowerHex(event.args.collateralToken),
    irm: lowerHex(event.args.irm),
    lltv: event.args.lltv,
    isLive: false,
    registeredAt: event.block.timestamp,
    registeredTxHash: lowerHex(event.transaction.hash),
    liveUpdatedAt: null,
    liveUpdatedTxHash: null,
  };

  await context.db
    .insert(lendingMarket)
    .values(row)
    .onConflictDoUpdate({
      loanToken: row.loanToken,
      collateralToken: row.collateralToken,
      irm: row.irm,
      lltv: row.lltv,
      registeredAt: row.registeredAt,
      registeredTxHash: row.registeredTxHash,
    });
});

ponder.on("FxMarketRegistryArc:PoolLiveSet", async ({ event, context }) => {
  const marketIdValue = lowerHex(event.args.marketId);
  const txHash = lowerHex(event.transaction.hash);

  await context.db
    .insert(lendingMarket)
    .values({
      // MarketRegistered should have fired before PoolLiveSet, but guard
      // for out-of-order replay with a zero-filled snapshot. The
      // onConflictDoUpdate path is what runs in steady state.
      marketId: marketIdValue,
      chainId: context.chain.id,
      loanToken: "0x0000000000000000000000000000000000000000",
      collateralToken: "0x0000000000000000000000000000000000000000",
      irm: "0x0000000000000000000000000000000000000000",
      lltv: 0n,
      isLive: event.args.isLive,
      registeredAt: event.block.timestamp,
      registeredTxHash: txHash,
      liveUpdatedAt: event.block.timestamp,
      liveUpdatedTxHash: txHash,
    })
    .onConflictDoUpdate({
      isLive: event.args.isLive,
      liveUpdatedAt: event.block.timestamp,
      liveUpdatedTxHash: txHash,
    });
});

ponder.on("FxMarketRegistryArc:BorrowDelegateSet", async ({ event, context }) => {
  const account = lowerHex(event.args.account);
  const delegate = lowerHex(event.args.delegate);
  const row = {
    id: delegateId(context.chain.id, event.args.account, event.args.delegate),
    chainId: context.chain.id,
    account,
    delegate,
    allowed: event.args.allowed,
    updatedAt: event.block.timestamp,
    updatedTxHash: lowerHex(event.transaction.hash),
  };

  await context.db
    .insert(borrowDelegate)
    .values(row)
    .onConflictDoUpdate({
      allowed: row.allowed,
      updatedAt: row.updatedAt,
      updatedTxHash: row.updatedTxHash,
    });
});

function delegateId(chainId: number, account: Hex, delegate: Hex): string {
  return `${chainId}:${lowerHex(account)}:${lowerHex(delegate)}`;
}

// ───────────────────── Wave I1 — FxLiquidationEngine ───────────────────

ponder.on("FxLiquidationEngineArc:AccountFlagged", async ({ event, context }) => {
  const meta = {
    chainId: context.chain.id,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  };
  const row = buildAccountFlaggedRow(
    {
      marketId: event.args.marketId,
      trader: event.args.trader,
      flagger: event.args.flagger,
    },
    meta,
  ) as {
    id: string;
    chainId: number;
    marketId: Hex;
    trader: Hex;
    state: string;
    actor: Hex;
    auto: boolean | null;
    blockNumber: bigint;
    blockTimestamp: bigint;
    txHash: Hex;
    logIndex: number;
  };

  // No realtime / Tinybird fan-out — flag events are operational signals,
  // not user-visible analytics. The DB row is sufficient for the API to
  // surface "trader X is flagged on market Y" without an extra contract
  // read. If a flag_events Tinybird dataset lands later, route through
  // publishEvent here.
  await context.db.insert(perpAccountFlag).values(row).onConflictDoNothing();
});

ponder.on("FxLiquidationEngineArc:AccountLiquidated", async ({ event, context }) => {
  const args = {
    marketId: event.args.marketId,
    trader: event.args.trader,
    liquidator: event.args.liquidator,
    reward: event.args.reward,
    socializedLoss: event.args.socializedLoss,
  };
  const meta = {
    chainId: context.chain.id,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  };

  await context.db
    .insert(perpLiquidation)
    .values({
      id: `${lowerHex(meta.txHash)}-${meta.logIndex}`,
      chainId: meta.chainId,
      marketId: lowerHex(args.marketId),
      trader: lowerHex(args.trader),
      liquidator: lowerHex(args.liquidator),
      rewardAtomic: args.reward,
      socializedLossAtomic: args.socializedLoss,
      blockNumber: meta.blockNumber,
      blockTimestamp: meta.blockTimestamp,
      txHash: lowerHex(meta.txHash),
      logIndex: meta.logIndex,
    })
    .onConflictDoNothing();

  // No realtime channel — matcher-driven realtime is the trade tape; the
  // keeper-side publish in Wave G2 already covers the liquidator's flow.
  // Ponder owns the analytics backfill / replay path.
  await publishEvent({
    analytics: {
      dataset: "perp_liquidation",
      row: buildAccountLiquidatedRow(args, meta),
    },
  });
});
