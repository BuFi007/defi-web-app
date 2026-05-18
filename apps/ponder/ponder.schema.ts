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
  // Additive columns wired by the Bento handlers ─────────────────────────
  // RoomCreated → contract-read snapshot fields:
  poolId: t.hex(),
  entryToken: t.hex(),
  minPlayers: t.integer(),
  rounds: t.integer(),
  roundDuration: t.integer(),
  lockBuffer: t.integer(),
  gridConfigHash: t.hex(),
  payoutHash: t.hex(),
  isPrivate: t.boolean(),
  // RoomLocked / RoomSettled / SettlementManager:
  lockedAt: t.bigint(),
  settledAt: t.bigint(),
  finalizedAt: t.bigint(),
  cancelledAt: t.bigint(),
  resultsRoot: t.hex(),
  payoutSchemaHash: t.hex(),
  payoutTotal: t.bigint(),
  protocolFee: t.bigint(),
  metadataURI: t.text(),
  // Replay cursor (mirrors perps.ts):
  eventBlock: t.bigint(),
  eventTxHash: t.hex(),
  eventLogIndex: t.integer(),
  updatedAt: t.bigint(),
}));

export const arcadePlacement = onchainTable("arcade_placement", (t) => ({
  id: t.text().primaryKey(), // `${roomId}:${player}:${tileId}`
  roomId: t.text().notNull(),
  player: t.hex().notNull(),
  tileId: t.text().notNull(),
  chips: t.integer().notNull(),
  commitment: t.hex(),
  revealedAt: t.bigint(),
  // Additive columns wired by the Bento handlers ─────────────────────────
  chainId: t.integer(),
  roundIndex: t.integer(),
  joinedAt: t.bigint(),
  joinedTxHash: t.hex(),
  leftAt: t.bigint(),
  refundedAt: t.bigint(),
  refundedAmount: t.bigint(),
  commitmentTxHash: t.hex(),
  revealedSelectionHash: t.hex(),
  revealedTxHash: t.hex(),
  prizeAmount: t.bigint(),
  claimedAt: t.bigint(),
  claimedTxHash: t.hex(),
  // Replay cursor:
  eventBlock: t.bigint(),
  eventTxHash: t.hex(),
  eventLogIndex: t.integer(),
}));

/**
 * Per-round lifecycle (FXBentoRoundManager). Each room runs N rounds; this
 * table captures anchor + settlement prices so the UI can render the
 * round-by-round price chart without a contract read per round.
 */
export const arcadeRound = onchainTable("arcade_round", (t) => ({
  id: t.text().primaryKey(), // `${roomId}:${roundIndex}`
  roomId: t.text().notNull(),
  chainId: t.integer().notNull(),
  roundIndex: t.integer().notNull(),
  startTime: t.bigint(),
  lockTime: t.bigint(),
  endTime: t.bigint(),
  anchorSnapshotId: t.bigint(),
  anchorPrice: t.text(), // int256 → keep as decimal string
  settlementSnapshotId: t.bigint(),
  settlementPrice: t.text(),
  status: t.text().notNull(), // started | anchor_recorded | settled
  eventBlock: t.bigint(),
  eventTxHash: t.hex(),
  eventLogIndex: t.integer(),
  updatedAt: t.bigint(),
}));

/**
 * FXBentoSettlementManager challenge lifecycle. Optional — surfaces disputes
 * if/when they happen on Arc.
 */
export const arcadeSettlement = onchainTable("arcade_settlement", (t) => ({
  id: t.text().primaryKey(), // `${roomId}:${stage}:${logIndex}`
  roomId: t.text().notNull(),
  chainId: t.integer().notNull(),
  stage: t.text().notNull(), // submitted | challenged | resolved | finalized | rescued
  resultsRoot: t.hex(),
  metadataURI: t.text(),
  challengeAccepted: t.boolean(),
  blockTimestamp: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));

export const telaranaLoan = onchainTable("telarana_loan", (t) => ({
  positionId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  borrower: t.hex().notNull(),
  marketId: t.text().notNull(),
  collateralAmount: t.bigint().notNull(),
  borrowAmount: t.bigint().notNull(),
  healthFactorBps: t.integer().notNull(),
  status: t.text().notNull(),
  openedAt: t.bigint().notNull(),
  openedTxHash: t.hex().notNull(),
  repaidAt: t.bigint(),
  repaidTxHash: t.hex(),
  liquidatedAt: t.bigint(),
  liquidatedTxHash: t.hex(),
  updatedAt: t.bigint().notNull(),
}));

/**
 * Mirrors GatewayHubRouteConfigured (TelaranaGatewayHubHook): the FX route is
 * the cross-chain market in v0 — pair of source/destination USDC plus the
 * Circle Gateway wallet/minter pair. We treat the routeId as the canonical
 * marketId so the API can join telaranaLoan rows against it.
 */
export const telaranaMarket = onchainTable("telarana_market", (t) => ({
  marketId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  routeId: t.hex().notNull(),
  sourceDomain: t.integer().notNull(),
  destinationDomain: t.integer().notNull(),
  sourceUsdc: t.hex().notNull(),
  destinationUsdc: t.hex().notNull(),
  sourceGatewayWallet: t.hex().notNull(),
  destinationGatewayMinter: t.hex().notNull(),
  signerMode: t.integer().notNull(),
  enabled: t.boolean().notNull(),
  metadataRef: t.hex(),
  registeredAt: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

/**
 * FxOracle ConfigUpdated snapshot. The liquidation scanner re-reads HF on
 * each block; this table just exposes the latest staleness bounds so the
 * API can surface "oracle window: 30s" without an extra read.
 */
export const telaranaOracleConfig = onchainTable("telarana_oracle_config", (t) => ({
  chainId: t.integer().primaryKey(),
  maxAge: t.bigint().notNull(),
  maxDeviationBps: t.bigint().notNull(),
  maxConfidenceBps: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
  updatedTxHash: t.hex().notNull(),
}));

/**
 * FxHubMessageReceiver deposit lifecycle (Fuji spoke). Lets the UI show
 * "pending CCTP attestation" / "stranded — sweep available" without
 * polling the contract.
 */
export const telaranaDeposit = onchainTable("telarana_deposit", (t) => ({
  messageNonce: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  beneficiary: t.hex().notNull(),
  amount: t.bigint().notNull(),
  status: t.text().notNull(), // executed | stranded | swept
  reason: t.hex(),
  executedAt: t.bigint(),
  strandedAt: t.bigint(),
  sweptAt: t.bigint(),
  updatedTxHash: t.hex().notNull(),
}));
