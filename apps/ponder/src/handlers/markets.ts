/**
 * FxMarketRegistry event handlers.
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
 * Naming convention follows perps.ts / telarana.ts: lowerHex everything,
 * use `${txHash}:${logIndex}` for append rows, and let `onConflictDoUpdate`
 * handle the lifecycle transitions.
 */
import { ponder } from "ponder:registry";
import { borrowDelegate, lendingMarket } from "ponder:schema";
import type { Hex } from "viem";

import { lowerHex } from "@bufi/shared-types/hex";

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
