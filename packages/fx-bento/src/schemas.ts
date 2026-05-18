// Zod primitives + per-domain schemas for the FX² Arcade engine.
// Ported from fx-bento monorepo (packages/shared-types, packages/market-data,
// packages/fx-bento). Inlined here because the defi-web-app `@bufi/shared-types`
// package is types-only and `@bufi/market-data` is Pyth/Hermes-focused — neither
// owns the arcade primitives.

import { z } from "zod";

// ---------- primitives (mirrors @bufinance/fx-bento-shared-types) ----------

export const AddressSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
  "Expected EVM address",
);

export const HexSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
  "Expected 0x-prefixed hex",
);

export const Hex32Schema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
  "Expected 32-byte 0x-prefixed hex",
);

export const MarketIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9-]+\/[A-Z0-9-]+$/);

export type Address = z.infer<typeof AddressSchema>;
export type Hex = z.infer<typeof HexSchema>;
export type MarketId = z.infer<typeof MarketIdSchema>;

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------- supported arcade markets (mirrors @bufinance/fx-bento-market-data) ----------

export const FX_BENTO_MARKETS: ReadonlyArray<{ id: MarketId; displayName: string }> = [
  { id: "USDC/EURC", displayName: "USDC / EURC" },
  { id: "USDC/MXNB", displayName: "USDC / MXNB" },
  { id: "USDC/BRL", displayName: "USDC / BRL" },
  { id: "USDC/JPYC", displayName: "USDC / JPYC" },
  { id: "USDC/QCAD", displayName: "USDC / QCAD" },
];

export function requireMarket(marketId: string): { id: MarketId; displayName: string } {
  const parsed = MarketIdSchema.safeParse(marketId);
  const id = parsed.success ? parsed.data : null;
  const market = id ? FX_BENTO_MARKETS.find((m) => m.id === id) : null;
  if (!market) throw new Error(`Unsupported market ${marketId}`);
  return market;
}

// ---------- accepts decimal strings (atomic uint), bigint, or non-neg int ----------

const BigNumberishSchema = z
  .union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((value) => BigInt(value));

// ---------- room lifecycle ----------

export const FxBentoRoomStatusSchema = z.enum([
  "lobby",
  "active",
  "settling",
  "settled",
  "cancelled",
]);

export type FxBentoRoomStatus = z.infer<typeof FxBentoRoomStatusSchema>;

export const CreateFxBentoRoomSchema = z.object({
  marketId: MarketIdSchema.default("USDC/EURC"),
  entryFeeUsdc: z.coerce.number().positive().max(1_000).default(5),
  minPlayers: z.coerce.number().int().min(2).max(100).default(2),
  maxPlayers: z.coerce.number().int().min(2).max(100).default(20),
  rounds: z.coerce.number().int().min(1).max(32).default(10),
  startTime: z.string().datetime().optional(),
  createdBy: AddressSchema.optional(),
});

export const JoinFxBentoRoomSchema = z.object({
  player: AddressSchema,
  signedEntryIntent: z.string().optional(),
  entryTxHash: HexSchema.optional(),
});

export const CommitSelectionSchema = z.object({
  player: AddressSchema,
  roundIndex: z.coerce.number().int().min(0),
  commitment: HexSchema,
});

export const RevealSelectionSchema = z.object({
  player: AddressSchema,
  roundIndex: z.coerce.number().int().min(0),
  rows: z.array(z.coerce.number().int().min(0).max(7)).min(1).max(5),
  cols: z.array(z.coerce.number().int().min(0).max(7)).min(1).max(5),
  nonce: HexSchema,
});

export const SettleFxBentoRoomSchema = z.object({
  resultsRoot: HexSchema,
  attestor: AddressSchema.optional(),
});

// ---------- onchain config ----------

export const PoolKeySchema = z.object({
  currency0: AddressSchema,
  currency1: AddressSchema,
  fee: z.coerce.number().int().nonnegative().max(1_000_000),
  tickSpacing: z.coerce.number().int().min(-887272).max(887272),
  hooks: AddressSchema,
});

export const OnchainRoomConfigSchema = z.object({
  poolKey: PoolKeySchema,
  entryToken: AddressSchema,
  entryFee: BigNumberishSchema,
  minPlayers: z.coerce.number().int().min(2).max(100),
  maxPlayers: z.coerce.number().int().min(2).max(100),
  rounds: z.coerce.number().int().min(1).max(256),
  roundDuration: z.coerce.number().int().positive(),
  lockBuffer: z.coerce.number().int().nonnegative(),
  startTime: z.coerce.number().int().nonnegative(),
  rakeBps: z.coerce.number().int().min(0).max(2_000),
  payoutBps: z.array(z.coerce.number().int().min(0).max(10_000)).min(1).max(100),
  gridConfigHash: Hex32Schema,
  isPrivate: z.boolean().default(false),
  inviteCodeHash: Hex32Schema.default(`0x${"00".repeat(32)}` as `0x${string}`),
});

export const TileSelectionSchema = z.object({
  rows: z.array(z.coerce.number().int().min(0).max(255)).min(1).max(5),
  cols: z.array(z.coerce.number().int().min(0).max(255)).min(1).max(5),
  chipCount: z.coerce.number().int().min(1).max(255),
  clientStateHash: Hex32Schema,
});

// ---------- settlement ----------

export const PrizeAllocationSchema = z.object({
  roomId: BigNumberishSchema,
  player: AddressSchema,
  amount: BigNumberishSchema,
  score: BigNumberishSchema.default(0n),
  rank: z.coerce.number().int().positive().default(1),
});

export const SettlementPayoutRootSchema = z.object({
  winnerRoot: Hex32Schema,
  rosterHash: Hex32Schema,
  leaderboardHash: Hex32Schema,
  scoreRoot: Hex32Schema,
  settlementPriceRoot: Hex32Schema,
  payoutTotal: BigNumberishSchema,
  protocolFee: BigNumberishSchema,
  metadataHash: Hex32Schema.optional(),
});

export const SettlementEvidenceSchema = z.object({
  version: z
    .literal("fx-bento-settlement-evidence-v1")
    .default("fx-bento-settlement-evidence-v1"),
  chainId: z.coerce.number().int().positive(),
  roomId: BigNumberishSchema,
  resultsRoot: Hex32Schema,
  metadataURI: z.string().min(1),
  scorerVersion: z.string().min(1).default("fx-bento-scoring-v1"),
  generatedAt: z.string().datetime().default(nowIso),
  challengeWindowEndsAt: z.string().datetime(),
  rounds: z.array(
    z.object({
      roundIndex: z.coerce.number().int().nonnegative(),
      anchorPrice: z.string().min(1),
      settlementPrice: z.string().min(1),
      anchorTxHash: HexSchema.optional(),
      settlementTxHash: HexSchema.optional(),
    }),
  ),
  allocations: z.array(PrizeAllocationSchema).min(1),
  totalPrizePayouts: BigNumberishSchema,
  protocolFee: BigNumberishSchema,
  attestor: AddressSchema.optional(),
  notes: z.string().max(2_000).optional(),
});

export const SettlementChallengeSchema = z.object({
  roomId: BigNumberishSchema,
  challenger: AddressSchema,
  reason: z.enum([
    "bad_price",
    "bad_score",
    "bad_allocation",
    "missing_data",
    "operator_error",
    "other",
  ]),
  evidenceURI: z.string().min(1),
  expectedResultsRoot: Hex32Schema.optional(),
  submittedAt: z.string().datetime().default(nowIso),
});

export type CreateFxBentoRoomInput = z.input<typeof CreateFxBentoRoomSchema>;
export type PoolKey = z.infer<typeof PoolKeySchema>;
export type OnchainRoomConfig = z.output<typeof OnchainRoomConfigSchema>;
export type TileSelection = z.output<typeof TileSelectionSchema>;
export type PrizeAllocation = z.output<typeof PrizeAllocationSchema>;
export type SettlementPayoutRoot = z.output<typeof SettlementPayoutRootSchema>;
export type SettlementEvidence = z.output<typeof SettlementEvidenceSchema>;
export type SettlementChallenge = z.output<typeof SettlementChallengeSchema>;
