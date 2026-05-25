import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { buildPerpsOrderTypedData, hashPerpsOrder } from "@bufi/perps";
import {
  ARC_CHAIN_ID, zAddress, zAmount, zSymbol, zSide, zSignature, zLeverage,
  resolveMarketId, computeSizeDelta, generateDeadlineAndNonce, withEip712Domain,
} from "../shared.ts";

const tradePrepare = route
  .post("/trade/prepare")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
      orderType: z.enum(["limit", "market"]).default("market"),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false),
      ttl: z.number().int().default(3600),
    }),
  )
  .meta({
    mcp: {
      title: "Prepare Trade",
      description:
        "Prepare a forex perp trade in one call. Pass human-readable symbol (e.g. 'EURC/USDC'), side, size in USDC, and leverage. Returns quote + EIP-712 typed data to sign. After signing, call bufi_trade_execute.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

    const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);
    const { deadline, nonce } = generateDeadlineAndNonce(body.ttl);

    const quote = await perpsService.quote({
      chainId: ARC_CHAIN_ID,
      marketId,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      sizeDelta,
      leverage: body.leverage,
    });

    const order = {
      chainId: ARC_CHAIN_ID as const,
      marketId,
      trader: body.trader,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      sizeDelta,
      leverage: body.leverage,
      deadline,
      nonce,
      orderType: body.orderType,
      limitPrice: body.limitPrice,
      reduceOnly: body.reduceOnly,
      postOnly: false,
    };

    return ok(jsonSafe({
      symbol: body.symbol,
      marketId,
      quote,
      order: {
        digest: hashPerpsOrder(order),
        typedData: withEip712Domain(buildPerpsOrderTypedData(order)),
        deadline,
        nonce,
      },
      costEstimate: {
        margin: `${(Number(body.sizeUsdc) / body.leverage).toFixed(4)} USDC`,
        fee: quote.fee ? `${quote.fee} atomic` : "see quote",
        x402Fee: "0.005 USDC",
      },
      nextStep: "Sign the order digest with your wallet, then call bufi_trade_execute with the signature.",
    }));
  });

const tradeExecute = route
  .post("/trade/execute")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
      orderType: z.enum(["limit", "market"]).default("market"),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false),
      postOnly: z.boolean().default(false),
      deadline: z.number().int(),
      nonce: z.string(),
      signature: zSignature,
    }),
  )
  .meta({
    mcp: {
      title: "Execute Trade",
      description:
        "Submit a signed forex perp order. Use the values from bufi_trade_prepare + your wallet signature. Returns the intent ID and SSE stream URL for real-time status tracking. x402: $0.005.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

    const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);

    const intent = await perpsService.createIntent({
      chainId: ARC_CHAIN_ID,
      marketId,
      trader: body.trader,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      sizeDelta,
      leverage: body.leverage,
      deadline: body.deadline,
      nonce: body.nonce,
      orderType: body.orderType,
      limitPrice: body.limitPrice,
      reduceOnly: body.reduceOnly,
      postOnly: body.postOnly,
      signature: body.signature,
    });

    const intentId = typeof intent === "object" && intent !== null && "intentId" in intent
      ? (intent as Record<string, unknown>).intentId
      : "unknown";

    return ok(jsonSafe({ intent, streamUrl: `/api/stream/prices/${body.symbol}` }));
  });

const closePrepare = route
  .post("/close/prepare")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      ttl: z.number().int().default(3600),
    }),
  )
  .meta({
    mcp: {
      title: "Prepare Close Position",
      description:
        "Prepare to close or reduce a forex perp position. Pass your current side (not the opposite). Returns EIP-712 typed data to sign. Then call bufi_trade_execute with reduceOnly=true.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

    const closeSide = body.side === "long" ? "short" : "long";
    const sizeDelta = computeSizeDelta(closeSide, body.sizeUsdc);
    const { deadline, nonce } = generateDeadlineAndNonce(body.ttl);

    const order = {
      chainId: ARC_CHAIN_ID as const,
      marketId,
      trader: body.trader,
      side: closeSide as "long" | "short",
      sizeUsdc: body.sizeUsdc,
      sizeDelta,
      leverage: 1,
      deadline,
      nonce,
      orderType: "market" as const,
      reduceOnly: true,
      postOnly: false,
    };

    return ok(jsonSafe({
      symbol: body.symbol,
      closing: body.side,
      order: {
        digest: hashPerpsOrder(order),
        typedData: withEip712Domain(buildPerpsOrderTypedData(order)),
        deadline,
        nonce,
        reduceOnly: true,
      },
      nextStep: "Sign the order digest, then call bufi_trade_execute with reduceOnly=true.",
    }));
  });

export default new Hyper({ prefix: "/api" }).use([tradePrepare, tradeExecute, closePrepare]);
