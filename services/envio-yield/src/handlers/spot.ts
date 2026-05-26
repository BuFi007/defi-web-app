import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

const USDC_BY_CHAIN: Record<number, string> = {
  5042002: "0x3600000000000000000000000000000000000000",
  43113: "0x5425890298aed601595a70AB815c96711a31Bc65",
};

indexer.onEvent(
  { contract: "FxSpotExecutor", event: "SpotFxExecuted" },
  async ({ event, context }) => {
    context.SpotSwap.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      requestId: event.params.requestId,
      routeId: event.params.routeId,
      sender: event.params.recipient,
      baseToken: USDC_BY_CHAIN[event.chainId] ?? "",
      quoteToken: event.params.tokenOut,
      baseAmount: event.params.usdcIn,
      quoteAmount: event.params.tokenOutDelivered,
      midE18: event.params.midE18,
      appliedSpreadBps: BigInt(event.params.appliedSpreadBps),
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.routeId,
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
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.routeId,
      trader: event.params.requestId,
      feeVault: event.params.feeVault,
      amount: event.params.amount,
      source: "spot",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);
