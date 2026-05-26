import { indexer } from "envio";

indexer.onEvent(
  { contract: "FxSpotExecutor", event: "SpotFxExecuted" },
  async ({ event, context }) => {
    context.SpotSwap.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      sender: event.params.sender,
      baseToken: event.params.baseToken,
      quoteToken: event.params.quoteToken,
      baseAmount: event.params.baseAmount,
      quoteAmount: event.params.quoteAmount,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });
  },
);
