import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

function lendingHandler(action: string) {
  return async ({ event, context }: any) => {
    const marketId = event.params.id.toLowerCase();
    context.LendingEvent.set({
      id: `${event.chainId}_${event.transaction.hash.toLowerCase()}_${event.logIndex}`,
      marketId,
      caller: event.params.caller.toLowerCase(),
      onBehalf: event.params.onBehalf.toLowerCase(),
      assets: event.params.assets,
      shares: event.params.shares,
      action,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(context, marketId, event.block.timestamp, event.chainId);
    const isSupplySide = action === "supply" || action === "withdraw";
    const nextTotalSupply =
      action === "supply"
        ? snap.totalSupply + event.params.assets
        : action === "withdraw"
          ? subtractFloorZero(snap.totalSupply, event.params.assets)
          : snap.totalSupply;
    const nextTotalBorrow =
      action === "borrow"
        ? snap.totalBorrow + event.params.assets
        : action === "repay"
          ? subtractFloorZero(snap.totalBorrow, event.params.assets)
          : snap.totalBorrow;

    context.DailyMarketSnapshot.set({
      ...snap,
      totalSupply: nextTotalSupply,
      totalBorrow: nextTotalBorrow,
      supplyEvents: isSupplySide ? snap.supplyEvents + 1 : snap.supplyEvents,
      borrowEvents: !isSupplySide ? snap.borrowEvents + 1 : snap.borrowEvents,
    });
  };
}

function subtractFloorZero(current: bigint, delta: bigint): bigint {
  return delta >= current ? 0n : current - delta;
}

indexer.onEvent(
  { contract: "MorphoBlue", event: "Supply" },
  lendingHandler("supply"),
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Withdraw" },
  lendingHandler("withdraw"),
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Borrow" },
  lendingHandler("borrow"),
);

indexer.onEvent(
  { contract: "MorphoBlue", event: "Repay" },
  lendingHandler("repay"),
);
