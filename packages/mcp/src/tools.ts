import { z } from "zod";

import type { ToolDefinition } from "./registry";

const addressLike = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hexLike = z.string().regex(/^0x[a-fA-F0-9]+$/);
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const chainIdLike = z.union([z.literal(43113), z.literal(5042002)]);
const usdcAmount = z.string().regex(/^\d+(\.\d{1,6})?$/);
const intString = z.string().regex(/^-?\d+$/);
const uintString = z.string().regex(/^\d+$/);

const spotQuoteInput = z.object({
  sourceChainId: z.literal(43113).default(43113),
  destinationChainId: z.literal(5042002).default(5042002),
  symbol: z.enum(["EURC", "JPYC", "MXNB", "CHFC"]),
  amountIn: usdcAmount,
});
const spotQuoteOutput = z.object({
  symbol: z.string(),
  routeId: hexLike,
  price: z.string().nullable(),
  minAmountOut: z.string().nullable(),
  oracleStaleSeconds: z.number().nullable(),
});

const perpQuoteInput = z.object({
  chainId: chainIdLike,
  marketId: bytes32,
  trader: addressLike.optional(),
  side: z.enum(["long", "short"]),
  sizeUsdc: usdcAmount,
  sizeDelta: intString.optional(),
  leverage: z.number().int().min(1).max(50),
});
const perpQuoteOutput = z.object({
  markPrice: z.string(),
  fee: z.string(),
  requiredMargin: z.string(),
  maxLeverage: z.number(),
  oracleStaleSeconds: z.number(),
});

const borrowPreviewInput = z.object({
  chainId: chainIdLike,
  marketId: z.string().min(1),
  collateralAmount: usdcAmount,
  borrowAmount: usdcAmount,
});
const borrowPreviewOutput = z.object({
  utilizationBps: z.number(),
  borrowApyBps: z.number(),
  healthFactorBps: z.number(),
});

const spotIntentInput = z.object({
  symbol: z.enum(["EURC", "JPYC", "MXNB", "CHFC"]),
  trader: addressLike,
  amountInAtomic: z.string().regex(/^\d+$/),
  minAmountOutAtomic: z.string().regex(/^\d+$/),
  deadline: z.number().int(),
  nonce: z.string().regex(/^\d+$/),
});
const intentOutput = z.object({
  digest: hexLike,
  typedData: z.record(z.string(), z.unknown()),
  calldata: hexLike.optional(),
});
const replacementIntentOutput = intentOutput.extend({
  originalIntentId: z.string(),
  replacementOf: z.string(),
  remainingSizeDelta: intString,
});

const bentoCreateInput = z.object({
  chainId: chainIdLike,
  marketId: z.string(),
  entryFeeUsdc: usdcAmount,
  chipsPerPlayer: z.number().int().min(1),
  maxPlayers: z.number().int().min(2).max(64),
  startsAt: z.number().int(),
  endsAt: z.number().int(),
});
const bentoCreateOutput = z.object({
  roomId: z.string(),
  entryUrl: z.string(),
});

const inspectPositionInput = z.object({
  chainId: chainIdLike,
  address: addressLike,
  marketId: z.string().optional(),
});
const inspectPositionOutput = z.object({
  source: z.enum(["onchain", "ponder", "reconciled"]),
  positions: z.array(z.unknown()),
});

const inspectLiquidatableInput = z.object({
  chainId: chainIdLike,
  marketId: z.string().optional(),
});
const inspectLiquidatableOutput = z.object({
  candidates: z.array(z.unknown()),
});

const inspectOracleInput = z.object({
  chainId: chainIdLike,
  symbol: z.enum(["USDC", "EUR", "JPY", "MXN", "CHF"]).optional(),
});
const inspectOracleOutput = z.object({
  stale: z.boolean(),
  lastUpdate: z.number().nullable(),
  staleSeconds: z.number().nullable(),
  confidence: z.string().nullable(),
});

const indexerSyncInput = z.object({
  scope: z.enum(["all", "bufx", "telarana", "perps", "bento"]).default("all"),
});
const indexerSyncOutput = z.object({
  triggeredAt: z.number(),
});

export function defaultToolDescriptors(): Array<
  Omit<ToolDefinition<unknown, unknown>, "execute" | "canExecute">
> {
  return [
    descriptor("bufx.quote.spot", "Live spot quote for USDC to FX token via Pyth and configured route.", spotQuoteInput, spotQuoteOutput),
    descriptor("bufx.quote.perp", "Read perps mark price, fee, and required margin from the clearinghouse.", perpQuoteInput, perpQuoteOutput),
    descriptor("bufx.preview.borrow", "Preview FX Telarana borrow utilization and APY from on-chain views.", borrowPreviewInput, borrowPreviewOutput),
    descriptor("bufx.intent.spot", "Build calldata for BUFX requestSpot.", spotIntentInput, intentOutput, { requiresSignature: true }),
    descriptor("bufx.intent.perp.open", "Build EIP-712 typed data for a perps open order.", perpQuoteInput.extend({
      trader: addressLike,
      deadline: z.number().int(),
      nonce: uintString,
      orderType: z.enum(["limit", "market"]).default("limit"),
      limitPrice: uintString.optional(),
      priceE18: uintString.optional(),
      reduceOnly: z.boolean().default(false),
      postOnly: z.boolean().default(false),
    }), intentOutput, { requiresSignature: true }),
    descriptor("bufx.intent.perp.replace", "Build EIP-712 typed data that re-enters a partially-filled residual with a fresh nonce.", z.object({
      originalIntentId: z.string().min(1),
      deadline: z.number().int(),
      nonce: uintString,
      sizeUsdc: usdcAmount.optional(),
      orderType: z.enum(["limit", "market"]).optional(),
      limitPrice: uintString.optional(),
      priceE18: uintString.optional(),
      reduceOnly: z.boolean().optional(),
      postOnly: z.boolean().optional(),
    }), replacementIntentOutput, { requiresSignature: true }),
    descriptor("bufx.bento.room.create", "Create an FX Bento room and return the room entry URL.", bentoCreateInput, bentoCreateOutput, {
      requiresPaymentUsdc: "0.5000",
      requiresSignature: true,
    }),
    descriptor("bufx.inspect.position", "Inspect a wallet position from on-chain and indexed state.", inspectPositionInput, inspectPositionOutput, {
      requiresSignature: true,
    }),
    descriptor("bufx.inspect.liquidatable", "Return liquidatable perps positions for public-good keepers.", inspectLiquidatableInput, inspectLiquidatableOutput),
    descriptor("bufx.inspect.oracle", "Inspect oracle staleness and confidence.", inspectOracleInput, inspectOracleOutput),
    descriptor("bufx.indexer.sync", "Force a reorg-safe indexer sync.", indexerSyncInput, indexerSyncOutput),
  ];
}

function descriptor<TIn, TOut>(
  name: string,
  description: string,
  inputSchema: z.ZodType<TIn>,
  outputSchema: z.ZodType<TOut>,
  gates: Pick<ToolDefinition<TIn, TOut>, "requiresPaymentUsdc" | "requiresSignature"> = {},
): Omit<ToolDefinition<TIn, TOut>, "execute" | "canExecute"> {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    ...gates,
  };
}
