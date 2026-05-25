import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { buildPerpsOrderTypedData, hashPerpsOrder } from "@bufi/perps";

const buildOrder = route
  .post("/trade/build")
  .body(
    z.object({
      marketId: z.string().min(1),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100),
      orderType: z.enum(["limit", "market"]).default("market"),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false),
    }),
  )
  .meta({
    mcp: {
      title: "Build Trade Order",
      description:
        "Build EIP-712 typed data for a forex perpetual futures order. Returns a digest to sign with your wallet. After signing, submit via bufi_submit_order. Supports long/short, 1-100x leverage, limit/market orders.",
    },
  })
  .handle(async ({ body }) => {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = String(Date.now());
    const order = {
      chainId: 5042002 as const,
      marketId: body.marketId,
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
    return ok(jsonSafe({ digest, typedData, deadline, nonce }));
  });

const submitOrder = route
  .post("/trade/submit")
  .body(
    z.object({
      marketId: z.string().min(1),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100),
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
      title: "Submit Signed Order",
      description:
        "Submit a signed forex perpetual futures order for matching. Requires the signature from bufi_build_trade_order. The matcher settles the trade on Arc with sub-second finality. x402 payment: $0.005 USDC.",
    },
  })
  .handle(async ({ body }) => {
    const intent = await perpsService.createIntent({
      chainId: 5042002,
      marketId: body.marketId,
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
    return ok(jsonSafe({ intent }));
  });

export default new Hyper({ prefix: "/api" }).use([buildOrder, submitOrder]);
