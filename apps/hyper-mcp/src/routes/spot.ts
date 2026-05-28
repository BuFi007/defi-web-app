import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { hermes, jsonSafe } from "../services.ts";
import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { buildVenueSpotIntent, quoteSpotOut } from "@bufi/fx-spot";
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

// USDC is 6 decimals on every supported chain. Spot FX tokens (EURC/JPYC/MXNB)
// are also 6 decimals. Output is auto-derived from the live Pyth price via the
// tested quoteSpotOut helper (all spot feeds are USD-per-token => divide).
const USDC_DECIMALS = 6;
const SPOT_TOKEN_DECIMALS = 6;

function usdcToAtomic(amountUsdc: string): string {
  const [whole, frac = ""] = amountUsdc.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) +
    BigInt((frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS))
  ).toString();
}

const spotBuy = route
  .post("/spot/buy")
  .body(
    z.object({
      symbol: z.enum(["EURC", "JPYC", "MXNB"]),
      trader: zAddress,
      // Human USDC amount, e.g. "5" or "1.50". Converted to atomic server-side.
      amountUsdc: zAmount,
      // Slippage tolerance in basis points (default 100 = 1%). The server fetches
      // the live price and derives minAmountOut for you — no pre-quote needed.
      slippageBps: z.number().int().min(0).max(9999).optional(),
      // Optional explicit override (atomic FX-token units). If set, it wins over
      // the slippage-derived value.
      minAmountOut: zUint.optional(),
    }),
  )
  .meta({
    mcp: {
      title: "Spot Buy FX Token",
      description:
        "Buy FX tokens (EURC, JPYC, MXNB) with USDC at spot price via Pyth oracle, in ONE call. Pass amountUsdc as a human decimal string (e.g. '5' = 5 USDC); the server converts to atomic, fetches the live price, and derives your slippage-protected minimum (default 1%, override with slippageBps or an explicit minAmountOut). Returns expectedOut, minAmountOut, and a digest to sign. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const { deadline, nonce } = generateDeadlineAndNonce();
    const amountInAtomic = usdcToAtomic(body.amountUsdc);

    // Derive minAmountOut from the live price unless the caller pinned one.
    const fxRoute = SPOT_FX_ROUTES[body.symbol];
    const latest = await hermes.latestPriceUpdates([fxRoute.pythFeedId]);
    const price = latest.prices[0];
    if (!price) return ok({ error: `no price available for ${body.symbol}` });

    const quoted = quoteSpotOut({
      amountUsdc: body.amountUsdc,
      priceRaw: price.price.price,
      expo: price.price.expo,
      tokenDecimals: SPOT_TOKEN_DECIMALS,
      usdcDecimals: USDC_DECIMALS,
      ...(body.slippageBps !== undefined && { slippageBps: body.slippageBps }),
    });
    const minAmountOut = body.minAmountOut ?? quoted.minAmountOut;

    const built = buildVenueSpotIntent({
      symbol: body.symbol,
      trader: body.trader,
      amountIn: amountInAtomic,
      minAmountOut,
      deadline,
      nonce,
    });
    return ok(jsonSafe({
      symbol: body.symbol,
      amountUsdc: body.amountUsdc,
      amountInAtomic,
      expectedOut: quoted.expectedOut,
      minAmountOut,
      slippageBps: body.minAmountOut !== undefined ? null : quoted.slippageBps,
      oracleStaleSeconds: Math.floor(Date.now() / 1000) - price.price.publish_time,
      digest: built.digest,
      typedData: built.typedData,
      calldata: built.calldata,
      deadline,
      nonce,
    }));
  });

export default new Hyper({ prefix: "/api" }).use([spotQuote, spotBuy]);
