import { z } from "zod";

export const chainIdSchema = z.union([
  z.literal(43113),
  z.literal(919),
  z.literal(5042002),
]);

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const hexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const usdcAmountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);
export const uintStringSchema = z.string().regex(/^\d+$/);
export const intStringSchema = z.string().regex(/^-?\d+$/);

export const perpsSideSchema = z.enum(["long", "short"]);

export const perpsQuoteRequest = z.object({
  chainId: chainIdSchema,
  marketId: bytes32Schema,
  trader: addressSchema.optional(),
  side: perpsSideSchema,
  sizeUsdc: usdcAmountSchema,
  /** Contract-native signed size delta. Preferred once Phase E contracts are live. */
  sizeDelta: intStringSchema.optional(),
  leverage: z.number().int().min(1).max(50),
});

export const perpsQuoteResponse = z.object({
  marketId: z.string(),
  side: perpsSideSchema,
  sizeUsdc: usdcAmountSchema,
  leverage: z.number().int(),
  fee: z.string(),
  markPrice: z.string(),
  requiredMargin: z.string(),
  maxLeverage: z.number().int(),
  oracleStaleSeconds: z.number().int(),
  oracle: z.object({
    source: z.enum(["pyth", "onchain"]),
    timestamp: z.number(),
    maxStaleSeconds: z.number(),
  }),
});

export const perpsIntentRequest = perpsQuoteRequest.extend({
  trader: addressSchema,
  deadline: z.number().int(),
  nonce: uintStringSchema,
  orderType: z.enum(["limit", "market"]).default("limit"),
  /** Back-compat alias for priceE18. */
  limitPrice: uintStringSchema.optional(),
  /** Contract SignedOrder.priceE18. Zero for market orders. */
  priceE18: uintStringSchema.optional(),
  reduceOnly: z.boolean().default(false),
  postOnly: z.boolean().default(false),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

const perpsTypedDataResponse = z.object({
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number(),
    verifyingContract: addressSchema,
  }),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

export const perpsIntentResponse = z.object({
  intentId: z.string(),
  digest: hexSchema,
  status: z.enum(["accepted", "rejected"]),
  /** EIP-712 typed data the trader must sign. */
  typedData: perpsTypedDataResponse,
});

export const perpsReplacementPrepareRequest = z.object({
  originalIntentId: z.string().min(1),
  nonce: uintStringSchema,
  deadline: z.number().int(),
  sizeUsdc: usdcAmountSchema.optional(),
  orderType: z.enum(["limit", "market"]).optional(),
  /** Back-compat alias for priceE18. */
  limitPrice: uintStringSchema.optional(),
  /** Contract SignedOrder.priceE18. Zero for market orders. */
  priceE18: uintStringSchema.optional(),
  reduceOnly: z.boolean().optional(),
  postOnly: z.boolean().optional(),
});

export const perpsReplacementSubmitRequest = perpsReplacementPrepareRequest.extend({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export const perpsReplacementPrepareResponse = z.object({
  originalIntentId: z.string(),
  replacementOf: z.string(),
  remainingSizeDelta: intStringSchema,
  digest: hexSchema,
  typedData: perpsTypedDataResponse,
});

export type PerpsQuoteRequest = z.infer<typeof perpsQuoteRequest>;
export type PerpsQuoteResponse = z.infer<typeof perpsQuoteResponse>;
export type PerpsIntentRequest = z.infer<typeof perpsIntentRequest>;
export type PerpsIntentResponse = z.infer<typeof perpsIntentResponse>;
export type PerpsReplacementPrepareRequest = z.infer<typeof perpsReplacementPrepareRequest>;
export type PerpsReplacementSubmitRequest = z.infer<typeof perpsReplacementSubmitRequest>;
export type PerpsReplacementPrepareResponse = z.infer<typeof perpsReplacementPrepareResponse>;
