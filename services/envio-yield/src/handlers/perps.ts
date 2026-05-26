import { indexer } from "envio";

indexer.onEvent(
  { contract: "FxOrderSettlement", event: "MatchSettled" },
  async ({ event, context }) => {
    const id = `${event.chainId}_${event.transaction.hash}_${event.logIndex}`;
    const day = new Date(event.block.timestamp * 1000).toISOString().slice(0, 10);

    context.PerpTrade.set({
      id,
      marketId: event.params.marketId,
      maker: event.params.maker,
      taker: event.params.taker,
      sizeDeltaE18: event.params.sizeDeltaE18,
      priceE18: event.params.priceE18,
      fee: event.params.fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snapId = `${event.chainId}_${event.params.marketId}_${day}`;
    const snap = await context.DailyMarketSnapshot.get(snapId);
    if (snap) {
      context.DailyMarketSnapshot.set({
        ...snap,
        perpVolume: snap.perpVolume + event.params.sizeDeltaE18,
        perpFees: snap.perpFees + event.params.fee,
        perpTradeCount: snap.perpTradeCount + 1,
      });
    } else {
      context.DailyMarketSnapshot.set({
        id: snapId,
        marketId: event.params.marketId,
        date: day,
        chainId: event.chainId,
        perpVolume: event.params.sizeDeltaE18,
        perpFees: event.params.fee,
        perpTradeCount: 1,
        spotVolume: 0n,
        spotTradeCount: 0,
        totalSupply: 0n,
        totalBorrow: 0n,
        supplyEvents: 0,
        borrowEvents: 0,
        lastFundingRate: 0n,
        annualizedFeeApy: 0n,
      });
    }
  },
);

indexer.onEvent(
  { contract: "FxPerpClearinghouse", event: "PositionChanged" },
  async ({ event, context }) => {
    context.PositionChange.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      marketId: event.params.marketId,
      trader: event.params.trader,
      sizeDeltaE18: event.params.sizeDeltaE18,
      resultingSizeE18: event.params.resultingSizeE18,
      entryPriceE18: event.params.entryPriceE18,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);

indexer.onEvent(
  { contract: "FxPerpClearinghouse", event: "FundingPoked" },
  async ({ event, context }) => {
    context.FundingEvent.set({
      id: `${event.chainId}_${event.params.marketId}_${event.params.timestamp}`,
      marketId: event.params.marketId,
      fundingRateE18: event.params.fundingRateE18,
      timestamp: Number(event.params.timestamp),
      chainId: event.chainId,
    });

    const day = new Date(Number(event.params.timestamp) * 1000).toISOString().slice(0, 10);
    const snapId = `${event.chainId}_${event.params.marketId}_${day}`;
    const snap = await context.DailyMarketSnapshot.get(snapId);
    if (snap) {
      context.DailyMarketSnapshot.set({
        ...snap,
        lastFundingRate: event.params.fundingRateE18,
      });
    }
  },
);
