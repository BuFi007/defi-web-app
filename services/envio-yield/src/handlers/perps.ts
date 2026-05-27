import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

indexer.onEvent(
  { contract: "FxOrderSettlement", event: "MatchSettled" },
  async ({ event, context }) => {
    const id = `${event.chainId}_${event.transaction.hash}_${event.logIndex}`;

    context.PerpTrade.set({
      id,
      marketId: event.params.marketId,
      maker: event.params.maker,
      taker: event.params.taker,
      sizeDeltaE18: event.params.fillSizeE18,
      priceE18: event.params.fillPriceE18,
      fee: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.marketId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      perpVolume: snap.perpVolume + event.params.fillSizeE18,
      perpTradeCount: snap.perpTradeCount + 1,
    });
  },
);

indexer.onEvent(
  { contract: "FxOrderSettlement", event: "OrderCancelled" },
  async ({ event, context }) => {
    context.PerpsOrderCancellation.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      chainId: event.chainId,
      trader: event.params.trader,
      nonce: BigInt(event.params.nonce),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "FxPerpClearinghouse", event: "PositionIncreased" },
  async ({ event, context }) => {
    context.PositionChange.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.marketId,
      trader: event.params.trader,
      action: "increase",
      sizeDeltaE18: event.params.sizeDeltaE18,
      resultingSizeE18: event.params.resultingSizeE18,
      entryPriceE18: event.params.entryPriceE18,
      fee: event.params.fee,
      realizedPnl: 0n,
      badDebt: 0n,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    upsertPosition(context, event.chainId, event.params.marketId, event.params.trader, {
      sizeE18: event.params.resultingSizeE18,
      entryPriceE18: event.params.entryPriceE18,
      marginReserved: event.params.marginReserved,
      lastEventKind: "increased",
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.marketId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      perpFees: snap.perpFees + event.params.fee,
    });
  },
);

indexer.onEvent(
  { contract: "FxPerpClearinghouse", event: "PositionDecreased" },
  async ({ event, context }) => {
    context.PositionChange.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.marketId,
      trader: event.params.trader,
      action: "decrease",
      sizeDeltaE18: event.params.sizeDeltaE18,
      resultingSizeE18: event.params.resultingSizeE18,
      entryPriceE18: event.params.priceE18,
      fee: 0n,
      realizedPnl: event.params.pnl,
      badDebt: event.params.badDebt,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    upsertPosition(context, event.chainId, event.params.marketId, event.params.trader, {
      sizeE18: event.params.resultingSizeE18,
      entryPriceE18: event.params.priceE18,
      marginReserved: event.params.marginReleased,
      lastEventKind: "decreased",
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

function upsertPosition(
  context: any,
  chainId: number,
  marketId: string,
  trader: string,
  data: {
    sizeE18: bigint;
    entryPriceE18: bigint;
    marginReserved: bigint;
    lastEventKind: string;
    blockNumber: number;
    blockTimestamp: number;
    txHash: string;
  },
) {
  const id = `${chainId}_${marketId}_${trader}`.toLowerCase();
  context.PerpsPosition.set({
    id,
    chainId,
    marketId: marketId.toLowerCase(),
    trader: trader.toLowerCase(),
    sizeE18: data.sizeE18,
    entryPriceE18: data.entryPriceE18,
    marginReserved: data.marginReserved,
    lastFundingVersion: 0n,
    lastEventKind: data.lastEventKind,
    isOpen: data.sizeE18 !== 0n,
    updatedAt: data.blockTimestamp,
    updatedBlockNumber: data.blockNumber,
    updatedTxHash: data.txHash.toLowerCase(),
  });
}

indexer.onEvent(
  { contract: "FxPerpClearinghouse", event: "TradingFeeRouted" },
  async ({ event, context }) => {
    context.TradingFeeRoute.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.marketId,
      trader: event.params.trader,
      feeVault: event.params.feeVault,
      amount: event.params.amount,
      source: "perp",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);

indexer.onEvent(
  { contract: "FxFundingEngine", event: "FundingPoked" },
  async ({ event, context }) => {
    context.FundingEvent.set({
      id: `${event.chainId}_${event.params.marketId}_${event.params.version}`,
      marketId: event.params.marketId,
      version: BigInt(event.params.version),
      fundingRateE18: event.params.rateE18PerSecond,
      cumulativeFundingE18: event.params.cumulativeFundingE18,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.marketId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      lastFundingRate: event.params.rateE18PerSecond,
      cumulativeFundingE18: event.params.cumulativeFundingE18,
    });
  },
);
