import { indexer } from "envio";

indexer.onEvent(
  { contract: "FxHedgeHook", event: "ExposureChanged" },
  async ({ event, context }) => {
    context.HedgeExposure.set({
      id: `${event.chainId}_${event.transaction.hash.toLowerCase()}_${event.logIndex}`,
      poolId: event.params.poolId.toLowerCase(),
      marketId: event.params.marketId.toLowerCase(),
      hedgeToken: event.params.hedgeToken.toLowerCase(),
      oldExposure: event.params.oldExposureE18,
      newExposure: event.params.newExposureE18,
      exposureDelta: event.params.exposureDeltaE18,
      txHash: event.transaction.hash.toLowerCase(),
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);

indexer.onEvent(
  { contract: "FxHedgeHook", event: "HedgeRebalanced" },
  async ({ event, context }) => {
    context.HedgeRebalance.set({
      id: `${event.chainId}_${event.transaction.hash.toLowerCase()}_${event.logIndex}`,
      poolId: event.params.poolId.toLowerCase(),
      marketId: event.params.marketId.toLowerCase(),
      hedgeToken: event.params.hedgeToken.toLowerCase(),
      oldSize: event.params.oldHedgeSizeE18,
      newSize: event.params.newHedgeSizeE18,
      exposure: event.params.exposureE18,
      pythFeedId: event.params.pythFeedId.toLowerCase(),
      txHash: event.transaction.hash.toLowerCase(),
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);
