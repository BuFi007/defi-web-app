import { onchainTable } from "ponder";

/**
 * Indexed entities. Mirrors the shapes in @bufi/shared-types so the
 * API can return rows directly without a remap layer.
 *
 * Schema is intentionally lightweight — fill in indexed columns and
 * relations as each contract ships and we know what query patterns
 * matter.
 */

export const perpsMarket = onchainTable("perps_market", (t) => ({
  marketId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  baseAsset: t.hex().notNull(),
  quoteAsset: t.hex().notNull(),
  openInterestUsdc: t.bigint().notNull(),
  fundingBps: t.integer().notNull(),
  oracleTimestamp: t.bigint().notNull(),
  enabled: t.boolean().notNull(),
}));

export const bufxRequest = onchainTable("bufx_request", (t) => ({
  requestId: t.hex().primaryKey(),
  chainId: t.integer().notNull(),
  requestType: t.hex(),
  marketId: t.hex(),
  trader: t.hex(),
  referrer: t.hex(),
  campaignId: t.hex(),
  amount: t.bigint(),
  status: t.text().notNull(),
  acceptedAt: t.bigint(),
  cancelledAt: t.bigint(),
  txHash: t.hex().notNull(),
}));

export const telaranaGatewayContext = onchainTable("telarana_gateway_context", (t) => ({
  requestId: t.hex().primaryKey(),
  chainId: t.integer().notNull(),
  routeId: t.hex().notNull(),
  telaranaGatewayHook: t.hex(),
  gatewayAction: t.integer().notNull(),
  sourceDepositor: t.hex().notNull(),
  sourceSigner: t.hex().notNull(),
  recipient: t.hex().notNull(),
  tokenOut: t.hex().notNull(),
  amount: t.bigint().notNull(),
  minAmountOut: t.bigint().notNull(),
  spotRouteId: t.hex().notNull(),
  metadataRef: t.hex(),
}));

export const spotSettlement = onchainTable("spot_settlement", (t) => ({
  requestId: t.hex().primaryKey(),
  chainId: t.integer().notNull(),
  routeId: t.hex().notNull(),
  tokenOut: t.hex().notNull(),
  recipient: t.hex().notNull(),
  amountIn: t.bigint().notNull(),
  amountOut: t.bigint().notNull(),
  executedAt: t.bigint().notNull(),
  txHash: t.hex().notNull(),
}));

export const oracleSnapshot = onchainTable("oracle_snapshot", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  base: t.hex().notNull(),
  quote: t.hex().notNull(),
  price: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
  txHash: t.hex().notNull(),
}));

export const perpsPosition = onchainTable("perps_position", (t) => ({
  positionId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  marketId: t.hex().notNull(),
  trader: t.hex().notNull(),
  sizeE18: t.bigint().notNull(),
  entryPriceE18: t.bigint().notNull(),
  marginReserved: t.bigint().notNull(),
  lastFundingVersion: t.bigint().notNull(),
  lastEventKind: t.text().notNull(),
  isOpen: t.boolean().notNull(),
  updatedAt: t.bigint().notNull(),
  updatedBlockNumber: t.bigint().notNull(),
  updatedTxHash: t.hex().notNull(),
}));

export const perpsPositionEvent = onchainTable("perps_position_event", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  marketId: t.hex().notNull(),
  trader: t.hex().notNull(),
  kind: t.text().notNull(),
  sizeDeltaE18: t.bigint().notNull(),
  resultingSizeE18: t.bigint().notNull(),
  priceE18: t.bigint().notNull(),
  marginAmount: t.bigint().notNull(),
  fee: t.bigint(),
  pnl: t.bigint(),
  badDebt: t.bigint(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));

export const perpsSettlement = onchainTable("perps_settlement", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  marketId: t.hex().notNull(),
  maker: t.hex().notNull(),
  taker: t.hex().notNull(),
  fillSizeE18: t.bigint().notNull(),
  fillPriceE18: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));

export const perpsOrderCancellation = onchainTable("perps_order_cancellation", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  trader: t.hex().notNull(),
  nonce: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));

export const arcadeRoom = onchainTable("arcade_room", (t) => ({
  roomId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  marketId: t.text().notNull(),
  entryFeeUsdc: t.bigint().notNull(),
  chipsPerPlayer: t.integer().notNull(),
  maxPlayers: t.integer().notNull(),
  status: t.text().notNull(),
  startsAt: t.bigint().notNull(),
  endsAt: t.bigint().notNull(),
  prizePoolUsdc: t.bigint().notNull(),
  rakeBps: t.integer().notNull(),
}));

export const arcadePlacement = onchainTable("arcade_placement", (t) => ({
  id: t.text().primaryKey(), // `${roomId}:${player}:${tileId}`
  roomId: t.text().notNull(),
  player: t.hex().notNull(),
  tileId: t.text().notNull(),
  chips: t.integer().notNull(),
  commitment: t.hex(),
  revealedAt: t.bigint(),
}));

export const telaranaLoan = onchainTable("telarana_loan", (t) => ({
  positionId: t.text().primaryKey(),
  borrower: t.hex().notNull(),
  marketId: t.text().notNull(),
  collateralAmount: t.bigint().notNull(),
  borrowAmount: t.bigint().notNull(),
  healthFactorBps: t.integer().notNull(),
  status: t.text().notNull(),
  openedAt: t.bigint().notNull(),
}));
