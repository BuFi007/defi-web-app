import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { hermes, jsonSafe } from "../services.ts";
import { SPOT_FX_ROUTES, CONTRACTS } from "@bufi/contracts";
import { buildVenueSpotIntent, quoteSpotOut } from "@bufi/fx-spot";
import { zAddress, zAmount, zUint, generateDeadlineAndNonce } from "../shared.ts";

// Spot settles on Avalanche Fuji (43113): the trader spends USDC there and must
// have approved the venue router. A best-effort pre-check reads balance + allowance
// so an agent doesn't sign a doomed order. NEVER blocks the intent — on any RPC
// error it returns a note and the order is still returned.
const SPOT_CHAIN_ID = 43113;
const FUJI_USDC = CONTRACTS[SPOT_CHAIN_ID].tokens.usdc as Address;
const FUJI_VENUE_ROUTER = CONTRACTS[SPOT_CHAIN_ID].bufx.venueRequestRouter as Address;
const FUJI_RPC = process.env.AVALANCHE_FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const fujiClient = createPublicClient({ transport: http(FUJI_RPC) });

async function spotPreflight(trader: Address, amountInAtomic: bigint) {
  try {
    const [balance, allowance] = await Promise.race([
      Promise.all([
        fujiClient.readContract({ address: FUJI_USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader] }) as Promise<bigint>,
        fujiClient.readContract({ address: FUJI_USDC, abi: erc20Abi, functionName: "allowance", args: [trader, FUJI_VENUE_ROUTER] }) as Promise<bigint>,
      ]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("preflight timeout")), 2500)),
    ]);
    return {
      chainId: SPOT_CHAIN_ID,
      usdcBalanceAtomic: balance.toString(),
      hasSufficientBalance: balance >= amountInAtomic,
      allowanceAtomic: allowance.toString(),
      hasSufficientAllowance: allowance >= amountInAtomic,
      spender: FUJI_VENUE_ROUTER,
      ...(allowance < amountInAtomic && {
        approvalNeeded: { token: FUJI_USDC, spender: FUJI_VENUE_ROUTER, atLeastAtomic: amountInAtomic.toString() },
      }),
    };
  } catch (e) {
    return { checked: false, note: `pre-check unavailable (${(e as Error).message}); the order is still valid and may succeed`, chainId: SPOT_CHAIN_ID };
  }
}

// Price-freshness bound for spot quotes (mirrors the perp oracle staleness gate).
// Lets an agent see how old the price is and whether it's past the staleness
// threshold, instead of inferring freshness only from the EIP-712 deadline.
const SPOT_MAX_STALE_SECONDS = Number(process.env.PYTH_MAX_STALE_SECONDS ?? 300);

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
        "Get a live spot quote for buying FX tokens (EURC, JPYC, MXNB) with USDC. Returns the Pyth oracle price (raw integer + its `expo` scale + a human `priceHuman` USD-per-token rate) AND `expectedOut` — the human-readable amount of the FX token that `amountUsdc` buys at this price (the same value post__api_spot_buy computes). Spot has zero protocol fee/spread beyond gas + the x402 charge (feeBps: 0). Use this before post__api_spot_buy to preview the trade.",
    },
  })
  .output(
    // `price` is the raw Pyth price integer as a string; multiply by 10**expo to get
    // the human USD-per-token rate (also returned as `priceHuman`). Both are null when
    // the feed has no fresh update. `expectedOut` is the FX token `amountUsdc` buys at
    // this price, matching post__api_spot_buy. `feeBps` is the protocol fee/spread on
    // the spot path: always 0 (see `feeNote`); the only charges are gas + x402.
    z.object({
      symbol: z.string(),
      amountUsdc: z.string(),
      price: z.string().nullable(),
      priceExpo: z.number().nullable(),
      priceHuman: z.string().nullable(),
      expectedOut: z.string().nullable(),
      feeBps: z.number(),
      feeNote: z.string(),
      oracleStaleSeconds: z.number().nullable(),
      maxStaleSeconds: z.number(),
      priceStale: z.boolean().nullable(),
      routeId: z.string(),
      tokenOut: z.string(),
    }),
  )
  .handle(async ({ body }) => {
    const route = SPOT_FX_ROUTES[body.symbol];
    const latest = await hermes.latestPriceUpdates([route.pythFeedId]);
    const price = latest.prices[0];
    const ageSeconds = price ? Math.floor(Date.now() / 1000) - price.price.publish_time : null;

    // Reuse the tested spot money math so the quote's `expectedOut` matches what
    // post__api_spot_buy returns. expectedOut is atomic FX-token units (6 dp); render
    // human by dividing by 10**SPOT_TOKEN_DECIMALS. priceHuman = raw * 10**expo.
    let priceHuman: string | null = null;
    let expectedOut: string | null = null;
    if (price) {
      priceHuman = (Number(price.price.price) * 10 ** price.price.expo).toString();
      const quoted = quoteSpotOut({
        amountUsdc: body.amountUsdc,
        priceRaw: price.price.price,
        expo: price.price.expo,
        tokenDecimals: SPOT_TOKEN_DECIMALS,
        usdcDecimals: USDC_DECIMALS,
      });
      expectedOut = (Number(quoted.expectedOut) / 10 ** SPOT_TOKEN_DECIMALS).toString();
    }

    return ok(jsonSafe({
      symbol: body.symbol,
      amountUsdc: body.amountUsdc,
      price: price?.price.price ?? null,
      priceExpo: price?.price.expo ?? null,
      priceHuman,
      expectedOut,
      feeBps: 0,
      feeNote:
        "Spot path has no protocol fee or spread; minAmountOut differs from expectedOut only by your slippage tolerance. Costs are gas on Fuji + the x402 charge ($0.001).",
      oracleStaleSeconds: ageSeconds,
      maxStaleSeconds: SPOT_MAX_STALE_SECONDS,
      priceStale: ageSeconds === null ? null : ageSeconds > SPOT_MAX_STALE_SECONDS,
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

    const preflight = await spotPreflight(body.trader as Address, BigInt(amountInAtomic));

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
      freshness: {
        priceAgeSeconds: Math.floor(Date.now() / 1000) - price.price.publish_time,
        maxStaleSeconds: SPOT_MAX_STALE_SECONDS,
        validUntilUnix: deadline,
      },
      preflight,
      digest: built.digest,
      typedData: built.typedData,
      calldata: built.calldata,
      deadline,
      nonce,
    }));
  });

export default new Hyper({ prefix: "/api" }).use([spotQuote, spotBuy]);
