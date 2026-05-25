import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { buildPerpsOrderTypedData, hashPerpsOrder } from "@bufi/perps";
import { livePerpsMarkets } from "@bufi/perps";

function resolveMarketId(symbol: string): string | null {
  const markets = livePerpsMarkets(5042002);
  const match = markets.find(
    (m) => m.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  return match?.marketId ?? null;
}

const SYMBOL_ENUM = ["EURC/USDC", "tJPYC/USDC", "MXNB/USDC", "CIRBTC/USDC", "AUDF/USDC"] as const;

const tradePrepare = route
  .post("/trade/prepare")
  .body(
    z.object({
      symbol: z.enum(SYMBOL_ENUM),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100).default(1),
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
        "Prepare a forex perp trade in one call. Pass human-readable symbol (e.g. 'EURC/USDC'), side, size in USDC, and leverage. Returns quote + EIP-712 typed data for both order and session signatures. After signing, call bufi_trade_execute. Nonce and deadline auto-generated. Up to 100x leverage.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

    const quote = await perpsService.quote({
      chainId: 5042002,
      marketId,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
    });

    const deadline = Math.floor(Date.now() / 1000) + body.ttl;
    const nonce = String(Date.now());
    const order = {
      chainId: 5042002 as const,
      marketId,
      trader: body.trader,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
      deadline,
      nonce,
      orderType: body.orderType,
      limitPrice: body.limitPrice,
      reduceOnly: body.reduceOnly,
      postOnly: false,
    };
    const digest = hashPerpsOrder(order);
    const typedData = buildPerpsOrderTypedData(order);
    return ok(jsonSafe({
      symbol: body.symbol,
      marketId,
      quote,
      order: {
        digest,
        typedData,
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
      symbol: z.enum(SYMBOL_ENUM),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100).default(1),
      orderType: z.enum(["limit", "market"]).default("market"),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false),
      postOnly: z.boolean().default(false),
      deadline: z.number().int(),
      nonce: z.string(),
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
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

    const intent = await perpsService.createIntent({
      chainId: 5042002,
      marketId,
      trader: body.trader,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
      deadline: body.deadline,
      nonce: body.nonce,
      orderType: body.orderType,
      limitPrice: body.limitPrice,
      reduceOnly: body.reduceOnly,
      postOnly: body.postOnly,
      signature: body.signature,
    });
    return ok(jsonSafe({
      intent,
      streamUrl: `/api/perps/intents/${typeof intent === "object" && intent !== null && "intentId" in intent ? (intent as Record<string, unknown>).intentId : "unknown"}/stream`,
    }));
  });

const closePrepare = route
  .post("/close/prepare")
  .body(
    z.object({
      symbol: z.enum(SYMBOL_ENUM),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      ttl: z.number().int().default(3600),
    }),
  )
  .meta({
    mcp: {
      title: "Prepare Close Position",
      description:
        "Prepare to close or reduce a forex perp position. Pass the side you're closing (your current side, not the opposite). Returns EIP-712 typed data to sign. Then call bufi_trade_execute with reduceOnly=true.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

    const closeSide = body.side === "long" ? "short" : "long";
    const deadline = Math.floor(Date.now() / 1000) + body.ttl;
    const nonce = String(Date.now());
    const order = {
      chainId: 5042002 as const,
      marketId,
      trader: body.trader,
      side: closeSide as "long" | "short",
      sizeUsdc: body.sizeUsdc,
      leverage: 1,
      deadline,
      nonce,
      orderType: "market" as const,
      reduceOnly: true,
      postOnly: false,
    };
    const digest = hashPerpsOrder(order);
    const typedData = buildPerpsOrderTypedData(order);
    return ok(jsonSafe({
      symbol: body.symbol,
      closing: body.side,
      order: { digest, typedData, deadline, nonce, reduceOnly: true },
      nextStep: "Sign the order digest, then call bufi_trade_execute with reduceOnly=true.",
    }));
  });

export default new Hyper({ prefix: "/api" }).use([tradePrepare, tradeExecute, closePrepare]);
