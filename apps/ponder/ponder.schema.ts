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

export const perpsPosition = onchainTable("perps_position", (t) => ({
  positionId: t.text().primaryKey(),
  trader: t.hex().notNull(),
  marketId: t.text().notNull(),
  side: t.text().notNull(),
  sizeUsdc: t.bigint().notNull(),
  leverage: t.integer().notNull(),
  entryPrice: t.bigint().notNull(),
  openedAt: t.bigint().notNull(),
  closedAt: t.bigint(),
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
