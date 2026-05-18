import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import { BYTES32_REGEX } from "@bufi/shared-types/schemas";

export const HUB_CHAIN_IDS = [43113, 5042002] as const;
export type HubChainIdLiteral = (typeof HUB_CHAIN_IDS)[number];

export const addressSchema = z
  .string()
  .refine(isAddress, "Expected an EVM address")
  .transform((value) => getAddress(value) as Address);

export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, "Expected a hex string") as unknown as z.ZodType<Hex>;

export const marketIdSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a bytes32 market id") as unknown as z.ZodType<Hex>;

export const bigintStringSchema = z
  .string()
  .regex(/^[0-9]+$/, "Expected an unsigned integer string")
  .transform((value) => BigInt(value));

export const hubChainIdSchema = z.union([z.literal(43113), z.literal(5042002)]);

export const marketPairSchema = z.object({
  loanToken: addressSchema,
  collateralToken: addressSchema,
  hubChainId: hubChainIdSchema,
});

export const marketRefSchema = z.object({
  hubChainId: hubChainIdSchema,
  marketId: marketIdSchema,
});

export const quoteSupplySchema = marketPairSchema.extend({
  assets: bigintStringSchema,
  account: addressSchema.optional(),
});

export const quoteBorrowSchema = marketPairSchema.extend({
  collateral: bigintStringSchema,
  borrowAmount: bigintStringSchema,
  account: addressSchema.optional(),
});

export const quoteRepaySchema = marketPairSchema.extend({
  assets: bigintStringSchema,
  account: addressSchema.optional(),
});

export const quoteWithdrawSchema = marketPairSchema.extend({
  shares: bigintStringSchema,
  account: addressSchema.optional(),
});

export const intentBaseSchema = marketPairSchema.extend({
  spokeChainId: z.number().int().positive(),
  onBehalf: addressSchema,
  nonce: bigintStringSchema,
  deadline: z.number().int().positive(),
});

export const supplyIntentSchema = intentBaseSchema.extend({
  assets: bigintStringSchema,
});

export const borrowIntentSchema = intentBaseSchema.extend({
  borrowAssets: bigintStringSchema,
  receiver: addressSchema,
});

export const repayIntentSchema = intentBaseSchema.extend({
  assets: bigintStringSchema,
});

export const withdrawIntentSchema = intentBaseSchema.extend({
  shares: bigintStringSchema,
  receiver: addressSchema,
});

export const collateralIntentSchema = intentBaseSchema.extend({
  collateral: bigintStringSchema,
});

export const liquidationCandidatesQuerySchema = z.object({
  hubChainId: hubChainIdSchema.optional(),
  marketId: marketIdSchema.optional(),
  limit: z.coerce.number().int().positive().max(250).default(50),
  cursor: z.string().optional(),
});

export const tvlQuerySchema = z.object({
  by: z.enum(["market", "hub", "total"]).default("total"),
});

export const intentSignatureSchema = z.object({
  signer: addressSchema,
  signature: hexSchema.refine(
    (value) => /^0x[0-9a-fA-F]{130}$/.test(value),
    "Expected a 65-byte ECDSA signature",
  ),
});

export const intentActionSchema = z.enum([
  "Supply",
  "Borrow",
  "Repay",
  "Withdraw",
  "SupplyCollateral",
  "WithdrawCollateral",
]);

// Legacy decimal-amount schema kept for downstream callers (e.g. the agent
// experience) that haven't migrated to bigint atomic units yet.
export const usdcAmountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);

export const fxMarketSymbol = z.enum([
  "USDC/EURC",
  // M3 + M4 pair from DeployFujiMxnbMarkets.s.sol — the loan/collateral
  // ordering matters: MXNB/USDC is the loan-MXNB, post-USDC market (M3);
  // USDC/MXNB is the inverse (M4). Both must appear in the schema so
  // intent builders accept either direction.
  "MXNB/USDC",
  "USDC/MXNB",
  "USDC/BRL",
  "USDC/JPYC",
  "USDC/QCAD",
]);

export const borrowQuoteRequest = z.object({
  chainId: hubChainIdSchema,
  marketId: z.string().min(1),
  collateralAmount: usdcAmountSchema,
  borrowAmount: usdcAmountSchema,
});

export const borrowQuoteResponse = z.object({
  marketId: z.string(),
  collateralAmount: usdcAmountSchema,
  borrowAmount: usdcAmountSchema,
  borrowApyBps: z.number(),
  collateralFactorBps: z.number(),
  healthFactorBps: z.number(),
  oracle: z.object({
    source: z.enum(["uniswap-v4", "pyth", "chainlink", "internal"]),
    timestamp: z.number(),
    maxStaleSeconds: z.number(),
  }),
});

export const borrowIntentRequest = borrowQuoteRequest.extend({
  borrower: addressSchema,
  deadline: z.number().int(),
});

export const borrowIntentResponse = z.object({
  intentId: z.string(),
  digest: z.string().regex(BYTES32_REGEX),
});

export type BorrowQuoteRequest = z.infer<typeof borrowQuoteRequest>;
export type BorrowQuoteResponse = z.infer<typeof borrowQuoteResponse>;
export type BorrowIntentRequest = z.infer<typeof borrowIntentRequest>;
export type BorrowIntentResponse = z.infer<typeof borrowIntentResponse>;
