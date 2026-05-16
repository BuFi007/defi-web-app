import { z } from "zod";

export const chainIdSchema = z.union([
  z.literal(43113),
  z.literal(919),
  z.literal(5042002),
]);

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const hexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/);
export const usdcAmountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);

export const perpsSideSchema = z.enum(["long", "short"]);

export const perpsQuoteRequest = z.object({
  chainId: chainIdSchema,
  marketId: z.string().min(1),
  side: perpsSideSchema,
  sizeUsdc: usdcAmountSchema,
  leverage: z.number().int().min(1).max(50),
});

export const perpsQuoteResponse = z.object({
  marketId: z.string(),
  side: perpsSideSchema,
  sizeUsdc: usdcAmountSchema,
  leverage: z.number().int(),
  indicativePrice: z.string(),
  estimatedFundingBps: z.number(),
  estimatedLiquidationPrice: z.string(),
  oracle: z.object({
    source: z.enum(["uniswap-v4", "pyth", "chainlink", "internal"]),
    timestamp: z.number(),
    maxStaleSeconds: z.number(),
  }),
});

export const perpsIntentRequest = perpsQuoteRequest.extend({
  trader: addressSchema,
  deadline: z.number().int(),
  nonce: z.string(),
});

export const perpsIntentResponse = z.object({
  intentId: z.string(),
  digest: hexSchema,
  /** EIP-712 typed data the trader must sign. */
  typedData: z.object({
    domain: z.object({
      name: z.string(),
      version: z.string(),
      chainId: z.number(),
      verifyingContract: addressSchema,
    }),
    types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
    primaryType: z.string(),
    message: z.record(z.string(), z.unknown()),
  }),
});

export type PerpsQuoteRequest = z.infer<typeof perpsQuoteRequest>;
export type PerpsQuoteResponse = z.infer<typeof perpsQuoteResponse>;
export type PerpsIntentRequest = z.infer<typeof perpsIntentRequest>;
export type PerpsIntentResponse = z.infer<typeof perpsIntentResponse>;
