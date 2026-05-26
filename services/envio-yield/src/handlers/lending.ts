import { indexer } from "envio";

function lendingHandler(action: string) {
  return async ({ event, context }: any) => {
    context.LendingEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.id,
      caller: event.params.caller,
      onBehalf: event.params.onBehalf,
      assets: event.params.assets,
      shares: event.params.shares,
      action,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const day = new Date(event.block.timestamp * 1000).toISOString().slice(0, 10);
    const snapId = `${event.chainId}_${event.params.id}_${day}`;
    const snap = await context.DailyMarketSnapshot.get(snapId);

    if (snap) {
      const isSupplySide = action === "supply" || action === "withdraw";
      context.DailyMarketSnapshot.set({
        ...snap,
        supplyEvents: isSupplySide ? snap.supplyEvents + 1 : snap.supplyEvents,
        borrowEvents: !isSupplySide ? snap.borrowEvents + 1 : snap.borrowEvents,
      });
    } else {
      context.DailyMarketSnapshot.set({
        id: snapId,
        marketId: event.params.id,
        date: day,
        chainId: event.chainId,
        perpVolume: 0n,
        perpFees: 0n,
        perpTradeCount: 0,
        spotVolume: 0n,
        spotTradeCount: 0,
        totalSupply: 0n,
        totalBorrow: 0n,
        supplyEvents: action === "supply" || action === "withdraw" ? 1 : 0,
        borrowEvents: action === "borrow" || action === "repay" ? 1 : 0,
        lastFundingRate: 0n,
        annualizedFeeApy: 0n,
      });
    }
  };
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
