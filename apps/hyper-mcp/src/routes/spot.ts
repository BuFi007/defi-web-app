import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { hermes, jsonSafe } from "../services.ts";
import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { buildVenueSpotIntent } from "@bufi/fx-spot";

const spotQuote = route
  .post("/spot/quote")
  .body(
    z.object({
      symbol: z.enum(["EURC", "JPYC", "MXNB"]),
      amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Spot FX Quote",
      description:
        "Get a live spot quote for buying FX tokens (EURC, JPYC, MXNB) with USDC. Returns the Pyth oracle price and estimated output amount. Use this before bufi_spot_buy to preview the trade.",
    },
  })
  .handle(async ({ body }) => {
    const route = SPOT_FX_ROUTES[body.symbol];
    const latest = await hermes.latestPriceUpdates([route.pythFeedId]);
    const price = latest.prices[0];
    return ok(jsonSafe({
      symbol: body.symbol,
      amountUsdc: body.amountUsdc,
      price: price?.price.price ?? null,
      oracleStaleSeconds: price
        ? Math.floor(Date.now() / 1000) - price.price.publish_time
        : null,
      routeId: route.routeId,
      tokenOut: route.tokenOut,
    }));
  });

const spotBuy = route
  .post("/spot/buy")
  .body(
    z.object({
      symbol: z.enum(["EURC", "JPYC", "MXNB"]),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amountInAtomic: z.string().regex(/^\d+$/),
      minAmountOutAtomic: z.string().regex(/^\d+$/),
    }),
  )
  .meta({
    mcp: {
      title: "Spot Buy FX Token",
      description:
        "Build EIP-712 typed data to buy FX tokens (EURC, JPYC, MXNB) with USDC at spot price via Pyth oracle. Returns a digest to sign with your wallet. Amounts are in atomic units (6 decimals for USDC). x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = String(Date.now());
    const built = buildVenueSpotIntent({
      symbol: body.symbol,
      trader: body.trader,
      amountIn: body.amountInAtomic,
      minAmountOut: body.minAmountOutAtomic,
      deadline,
      nonce,
    });
    return ok(jsonSafe({
      digest: built.digest,
      typedData: built.typedData,
      calldata: built.calldata,
      deadline,
      nonce,
    }));
  });

export default new Hyper({ prefix: "/api" }).use([spotQuote, spotBuy]);
