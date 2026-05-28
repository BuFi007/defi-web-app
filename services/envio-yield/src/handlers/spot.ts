import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

const USDC_BY_CHAIN: Record<number, string> = {
  5042002: "0x3600000000000000000000000000000000000000",
  43113: "0x5425890298aed601595a70ab815c96711a31bc65",
};

indexer.onEvent(
  { contract: "FxSpotExecutor", event: "SpotFxExecuted" },
  async ({ event, context }) => {
    const routeId = event.params.routeId.toLowerCase();
    context.SpotSwap.set({
      id: `${event.chainId}_${event.transaction.hash.toLowerCase()}_${event.logIndex}`,
      requestId: event.params.requestId.toLowerCase(),
      routeId,
      sender: event.params.recipient.toLowerCase(),
      baseToken: (USDC_BY_CHAIN[event.chainId] ?? "").toLowerCase(),
      quoteToken: event.params.tokenOut.toLowerCase(),
      baseAmount: event.params.usdcIn,
      quoteAmount: event.params.tokenOutDelivered,
      midE18: event.params.midE18,
      appliedSpreadBps: BigInt(event.params.appliedSpreadBps),
      txHash: event.transaction.hash.toLowerCase(),
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      routeId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      spotVolume: snap.spotVolume + event.params.usdcIn,
      spotTradeCount: snap.spotTradeCount + 1,
    });
  },
);

indexer.onEvent(
  { contract: "FxSpotExecutor", event: "SpotFeeRouted" },
  async ({ event, context }) => {
    context.TradingFeeRoute.set({
      id: `${event.chainId}_${event.transaction.hash.toLowerCase()}_${event.logIndex}`,
      marketId: event.params.routeId.toLowerCase(),
      trader: event.params.requestId.toLowerCase(),
      feeVault: event.params.feeVault.toLowerCase(),
      amount: event.params.amount,
      source: "spot",
      txHash: event.transaction.hash.toLowerCase(),
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);
