import { ponder } from "ponder:registry";
import type { Context } from "ponder:registry";
import {
  perpsBadDebt,
  perpsMarketConfig,
  perpsOrderCancellation,
  perpsPosition,
  perpsPositionEvent,
  perpsProtocolConfig,
  perpsSettlement,
} from "ponder:schema";
import type { Address, Hex } from "viem";

import { FxPerpClearinghouseAbi } from "@bufi/contracts";
import { lowerHex } from "@bufi/shared-types/hex";

type PositionEventName =
  | "FxPerpClearinghouseArc:PositionIncreased"
  | "FxPerpClearinghouseArc:PositionDecreased";

ponder.on("FxOrderSettlementArc:MatchSettled", async ({ event, context }) => {
  await context.db
    .insert(perpsSettlement)
    .values({
      id: logId(event),
      chainId: context.chain.id,
      marketId: lowerHex(event.args.marketId),
      maker: lowerHex(event.args.maker),
      taker: lowerHex(event.args.taker),
      fillSizeE18: event.args.fillSizeE18,
      fillPriceE18: event.args.fillPriceE18,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: lowerHex(event.transaction.hash),
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();
});

ponder.on("FxOrderSettlementArc:OrderCancelled", async ({ event, context }) => {
  await context.db
    .insert(perpsOrderCancellation)
    .values({
      id: logId(event),
      chainId: context.chain.id,
      trader: lowerHex(event.args.trader),
      nonce: BigInt(event.args.nonce),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: lowerHex(event.transaction.hash),
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();
});

ponder.on("FxPerpClearinghouseArc:PositionIncreased", async ({ event, context }) => {
  await context.db
    .insert(perpsPositionEvent)
    .values({
      id: logId(event),
      chainId: context.chain.id,
      marketId: lowerHex(event.args.marketId),
      trader: lowerHex(event.args.trader),
      kind: "increased",
      sizeDeltaE18: event.args.sizeDeltaE18,
      resultingSizeE18: event.args.resultingSizeE18,
      priceE18: event.args.entryPriceE18,
      marginAmount: event.args.marginReserved,
      fee: event.args.fee,
      pnl: null,
      badDebt: null,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: lowerHex(event.transaction.hash),
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();

  await upsertLatestPosition({
    context,
    marketId: event.args.marketId,
    trader: event.args.trader,
    kind: "increased",
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("FxPerpClearinghouseArc:PositionDecreased", async ({ event, context }) => {
  await context.db
    .insert(perpsPositionEvent)
    .values({
      id: logId(event),
      chainId: context.chain.id,
      marketId: lowerHex(event.args.marketId),
      trader: lowerHex(event.args.trader),
      kind: "decreased",
      sizeDeltaE18: event.args.sizeDeltaE18,
      resultingSizeE18: event.args.resultingSizeE18,
      priceE18: event.args.priceE18,
      marginAmount: event.args.marginReleased,
      fee: null,
      pnl: event.args.pnl,
      badDebt: event.args.badDebt,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: lowerHex(event.transaction.hash),
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();

  await upsertLatestPosition({
    context,
    marketId: event.args.marketId,
    trader: event.args.trader,
    kind: "decreased",
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("FxPerpClearinghouseArc:MarketConfigured", async ({ event, context }) => {
  const cfg = event.args.config;
  const row = {
    marketId: lowerHex(event.args.marketId),
    chainId: context.chain.id,
    baseToken: lowerHex(cfg.baseToken),
    enabled: cfg.enabled,
    initialMarginBps: Number(cfg.initialMarginBps),
    maintenanceMarginBps: Number(cfg.maintenanceMarginBps),
    tradingFeeBps: Number(cfg.tradingFeeBps),
    maxLeverageBps: BigInt(cfg.maxLeverageBps),
    maxOpenInterestUsd: cfg.maxOpenInterestUsd,
    maxSkewUsd: cfg.maxSkewUsd,
    updatedAt: event.block.timestamp,
    updatedTxHash: lowerHex(event.transaction.hash),
  };

  await context.db
    .insert(perpsMarketConfig)
    .values(row)
    .onConflictDoUpdate({
      baseToken: row.baseToken,
      enabled: row.enabled,
      initialMarginBps: row.initialMarginBps,
      maintenanceMarginBps: row.maintenanceMarginBps,
      tradingFeeBps: row.tradingFeeBps,
      maxLeverageBps: row.maxLeverageBps,
      maxOpenInterestUsd: row.maxOpenInterestUsd,
      maxSkewUsd: row.maxSkewUsd,
      updatedAt: row.updatedAt,
      updatedTxHash: row.updatedTxHash,
    });
});

ponder.on("FxPerpClearinghouseArc:BadDebtSocialized", async ({ event, context }) => {
  await context.db
    .insert(perpsBadDebt)
    .values({
      id: logId(event),
      chainId: context.chain.id,
      marketId: lowerHex(event.args.marketId),
      trader: lowerHex(event.args.trader),
      amount: event.args.amount,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      txHash: lowerHex(event.transaction.hash),
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();
});

ponder.on("FxPerpClearinghouseArc:FundingEngineSet", async ({ event, context }) => {
  const txHash = lowerHex(event.transaction.hash);
  await context.db
    .insert(perpsProtocolConfig)
    .values({
      chainId: context.chain.id,
      fundingEngine: lowerHex(event.args.fundingEngine),
      fundingEngineUpdatedAt: event.block.timestamp,
      fundingEngineUpdatedTxHash: txHash,
    })
    .onConflictDoUpdate({
      fundingEngine: lowerHex(event.args.fundingEngine),
      fundingEngineUpdatedAt: event.block.timestamp,
      fundingEngineUpdatedTxHash: txHash,
    });
});

async function upsertLatestPosition(args: {
  context: Context<PositionEventName>;
  marketId: Hex;
  trader: Address;
  kind: "increased" | "decreased";
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: Hex;
}): Promise<void> {
  const latest = normalizePosition(
    await args.context.client.readContract({
      address: args.context.contracts.FxPerpClearinghouseArc.address,
      abi: FxPerpClearinghouseAbi,
      functionName: "position",
      args: [args.marketId, args.trader],
      blockNumber: args.blockNumber,
    }),
  );
  const row = {
    positionId: positionId(args.marketId, args.trader),
    chainId: args.context.chain.id,
    marketId: lowerHex(args.marketId),
    trader: lowerHex(args.trader),
    sizeE18: latest.sizeE18,
    entryPriceE18: latest.entryPriceE18,
    marginReserved: latest.marginReserved,
    lastFundingVersion: latest.lastFundingVersion,
    lastEventKind: args.kind,
    isOpen: latest.sizeE18 !== 0n,
    updatedAt: args.blockTimestamp,
    updatedBlockNumber: args.blockNumber,
    updatedTxHash: lowerHex(args.txHash),
  };

  await args.context.db
    .insert(perpsPosition)
    .values(row)
    .onConflictDoUpdate({
      chainId: row.chainId,
      marketId: row.marketId,
      trader: row.trader,
      sizeE18: row.sizeE18,
      entryPriceE18: row.entryPriceE18,
      marginReserved: row.marginReserved,
      lastFundingVersion: row.lastFundingVersion,
      lastEventKind: row.lastEventKind,
      isOpen: row.isOpen,
      updatedAt: row.updatedAt,
      updatedBlockNumber: row.updatedBlockNumber,
      updatedTxHash: row.updatedTxHash,
    });
}

function normalizePosition(value: unknown): {
  sizeE18: bigint;
  entryPriceE18: bigint;
  marginReserved: bigint;
  lastFundingVersion: bigint;
} {
  const tuple = value as {
    readonly 0?: bigint;
    readonly 1?: bigint;
    readonly 2?: bigint;
    readonly 3?: bigint | number;
    readonly sizeE18?: bigint;
    readonly entryPriceE18?: bigint;
    readonly marginReserved?: bigint;
    readonly lastFundingVersion?: bigint | number;
  };
  return {
    sizeE18: tuple.sizeE18 ?? tuple[0] ?? 0n,
    entryPriceE18: tuple.entryPriceE18 ?? tuple[1] ?? 0n,
    marginReserved: tuple.marginReserved ?? tuple[2] ?? 0n,
    lastFundingVersion: BigInt(tuple.lastFundingVersion ?? tuple[3] ?? 0),
  };
}

function logId(event: { transaction: { hash: Hex }; log: { logIndex: number } }): string {
  return `${lowerHex(event.transaction.hash)}:${event.log.logIndex}`;
}

function positionId(marketId: Hex, trader: Address): string {
  return `${lowerHex(marketId)}:${lowerHex(trader)}`;
}
