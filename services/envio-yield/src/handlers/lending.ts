import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

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

    const snap = await getOrCreateDailyMarketSnapshot(context, event.params.id, event.block.timestamp, event.chainId);
    const isSupplySide = action === "supply" || action === "withdraw";

    context.DailyMarketSnapshot.set({
      ...snap,
      supplyEvents: isSupplySide ? snap.supplyEvents + 1 : snap.supplyEvents,
      borrowEvents: !isSupplySide ? snap.borrowEvents + 1 : snap.borrowEvents,
    });
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
