import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { hermes, jsonSafe } from "../services.ts";
import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { buildVenueSpotIntent } from "@bufi/fx-spot";
import { zAddress, zAmount, zUint, generateDeadlineAndNonce } from "../shared.ts";

const spotQuote = route
  .post("/spot/quote")
  .body(
    z.object({
      symbol: z.enum(["EURC", "JPYC", "MXNB"]),
      amountUsdc: zAmount,
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

// USDC is 6 decimals on every supported chain. The INPUT side is therefore
// unambiguous to humanize. The OUTPUT side (minAmountOut) is NOT auto-derived
// here: pair direction varies per Pyth feed (EUR/USD divides, USD/JPY-style
// feeds multiply ~150x) and per-token decimals differ, so guessing it would be
// a money bug. Until a tested per-feed quote helper lands in @bufi/fx-spot,
// minAmountOut stays an explicit caller input for slippage safety.
// See DOGFOOD_PLAN.md 1.3 / 2.2.
const USDC_DECIMALS = 6;

const spotBuy = route
  .post("/spot/buy")
  .body(
    z.object({
      symbol: z.enum(["EURC", "JPYC", "MXNB"]),
      trader: zAddress,
      // Human USDC amount, e.g. "5" or "1.50". Converted to atomic server-side.
      amountUsdc: zAmount,
      // Minimum FX-token output in atomic units (the token's own decimals),
      // for slippage protection. Get the price from /api/spot/quote first.
      minAmountOut: zUint,
    }),
  )
  .meta({
    mcp: {
      title: "Spot Buy FX Token",
      description:
        "Build EIP-712 typed data to buy FX tokens (EURC, JPYC, MXNB) with USDC at spot price via Pyth oracle. Pass amountUsdc as a human decimal string (e.g. '5' = 5 USDC) — the server converts to atomic. minAmountOut is your slippage floor in the FX token's atomic units; call /api/spot/quote first for the price. Returns a digest to sign. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const { deadline, nonce } = generateDeadlineAndNonce();
    // Safe: USDC is always 6 decimals. Parse the human decimal string without
    // float drift by splitting on the decimal point.
    const [whole, frac = ""] = body.amountUsdc.split(".");
    const amountInAtomic =
      (BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) +
        BigInt((frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS))).toString();
    const built = buildVenueSpotIntent({
      symbol: body.symbol,
      trader: body.trader,
      amountIn: amountInAtomic,
      minAmountOut: body.minAmountOut,
      deadline,
      nonce,
    });
    return ok(jsonSafe({
      symbol: body.symbol,
      amountUsdc: body.amountUsdc,
      amountInAtomic,
      minAmountOut: body.minAmountOut,
      digest: built.digest,
      typedData: built.typedData,
      calldata: built.calldata,
      deadline,
      nonce,
    }));
  });

export default new Hyper({ prefix: "/api" }).use([spotQuote, spotBuy]);
