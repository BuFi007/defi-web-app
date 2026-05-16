import { z } from "zod";

export const chainIdSchema = z.union([
  z.literal(43113),
  z.literal(919),
  z.literal(5042002),
]);

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const usdcAmountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);

export const fxMarketSymbol = z.enum([
  "USDC/EURC",
  "USDC/MXNB",
  "USDC/BRL",
  "USDC/JPYC",
  "USDC/QCAD",
]);

export const borrowQuoteRequest = z.object({
  chainId: chainIdSchema,
  marketId: z.string().min(1),
  collateralAmount: usdcAmountSchema,
  borrowAmount: usdcAmountSchema,
});

export const borrowQuoteResponse = z.object({
  marketId: z.string(),
  collateralAmount: usdcAmountSchema,
  borrowAmount: usdcAmountSchema,
  borrowApyBps: z.number(),
  /** Max LTV the market allows, 1e4-scaled. */
  collateralFactorBps: z.number(),
  /** Projected health factor after the borrow lands. 1e4-scaled. */
  healthFactorBps: z.number(),
  /** Oracle freshness — agent must refuse a stale quote. */
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
  digest: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export type BorrowQuoteRequest = z.infer<typeof borrowQuoteRequest>;
export type BorrowQuoteResponse = z.infer<typeof borrowQuoteResponse>;
export type BorrowIntentRequest = z.infer<typeof borrowIntentRequest>;
export type BorrowIntentResponse = z.infer<typeof borrowIntentResponse>;
