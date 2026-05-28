import {
  CONTRACTS,
  LIVE_ROUTE_IDS,
  SPOT_FX_ROUTES,
  buFxVenueRequestRouterAbi,
  type SpotFxSymbol,
} from "@bufi/contracts";
import {
  encodeFunctionData,
  hashTypedData,
  isAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { z } from "zod";

import { ADDRESS_REGEX, BYTES32_REGEX } from "@bufi/shared-types/schemas";

const addressSchema = z.string().regex(ADDRESS_REGEX);
const bytes32Schema = z.string().regex(BYTES32_REGEX);

export const spotIntentRequestSchema = z.object({
  sourceChainId: z.literal(43113).default(43113),
  destinationChainId: z.literal(5042002).default(5042002),
  symbol: z.enum(["EURC", "JPYC", "MXNB", "CHFC"]),
  trader: addressSchema,
  amountIn: z.string().regex(/^\d+$/),
  minAmountOut: z.string().regex(/^\d+$/),
  maxExecutionFee: z.string().regex(/^\d+$/).default("0"),
  deadline: z.number().int().positive(),
  nonce: z.string().regex(/^\d+$/),
  referrer: addressSchema.default(zeroAddress),
  campaignId: bytes32Schema.default(`0x${"0".repeat(64)}`),
  data: z
    .string()
    .regex(/^0x([a-fA-F0-9]{2})*$/)
    .default("0x"),
});

export type SpotIntentRequest = z.input<typeof spotIntentRequestSchema>;

export interface VenueSpotRequest {
  marketId: Hex;
  trader: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  maxExecutionFee: bigint;
  deadline: bigint;
  referrer: Address;
  campaignId: Hex;
  data: Hex;
}

export const VENUE_EIP712_DOMAIN = {
  name: "BUFX Venue Request Router",
  version: "1",
} as const;

export const VENUE_SPOT_REQUEST_TYPES = {
  SpotRequest: [
    { name: "marketId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "maxExecutionFee", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "referrer", type: "address" },
    { name: "campaignId", type: "bytes32" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface BuiltSpotIntent {
  routeId: Hex;
  router: Address;
  request: VenueSpotRequest;
  nonce: bigint;
  digest: Hex;
  typedData: {
    domain: TypedDataDomain;
    types: typeof VENUE_SPOT_REQUEST_TYPES;
    primaryType: "SpotRequest";
    message: ReturnType<typeof typedDataMessage>;
  };
  calldata: Hex;
}

export function buildVenueSpotIntent(input: SpotIntentRequest): BuiltSpotIntent {
  const parsed = spotIntentRequestSchema.parse(input);
  const route = SPOT_FX_ROUTES[parsed.symbol as SpotFxSymbol];
  const source = CONTRACTS[parsed.sourceChainId];
  const router = source.bufx.venueRequestRouter;
  if (!router) {
    throw new Error(`BUFX venue router is not configured for chain ${parsed.sourceChainId}`);
  }
  const request: VenueSpotRequest = {
    marketId: route.routeId,
    trader: normalizeAddress(parsed.trader),
    tokenOut: route.tokenOut,
    amountIn: BigInt(parsed.amountIn),
    minAmountOut: BigInt(parsed.minAmountOut),
    maxExecutionFee: BigInt(parsed.maxExecutionFee),
    deadline: BigInt(parsed.deadline),
    referrer: normalizeAddress(parsed.referrer),
    campaignId: parsed.campaignId as Hex,
    data: parsed.data as Hex,
  };
  const nonce = BigInt(parsed.nonce);
  const typedData = buildVenueSpotTypedData({
    chainId: parsed.sourceChainId,
    verifyingContract: router,
    request,
    nonce,
  });
  const digest = hashTypedData(typedData);
  return {
    routeId: route.routeId,
    router,
    request,
    nonce,
    digest,
    typedData,
    calldata: encodeUnsignedVenueSpotRequest(request),
  };
}

/**
 * Convert a human USDC amount into the expected FX-token output in atomic units,
 * plus a slippage-protected minimum, from a Pyth price.
 *
 * Direction: ALL bufi spot feeds (EURC, JPYC, MXNB) are quoted USD-per-token,
 * so the conversion is uniformly out = in / price. Verified against live feeds
 * 2026-05-28: EURC≈1.165, JPYC≈0.00159, MXNB≈0.0173 USD/token. (If a future feed
 * were quoted token-per-USD this would invert — gate new symbols on a check.)
 *
 * Integer math only (no float drift); output is floored (conservative for a
 * buyer's minimum). expo is the Pyth exponent (negative, e.g. -8).
 *
 *   out_atomic = amountUsdcAtomic * 10^(tokenDecimals - usdcDecimals - expo) / priceRaw
 */
export function quoteSpotOut(args: {
  amountUsdc: string;
  priceRaw: string;
  expo: number;
  tokenDecimals?: number;
  usdcDecimals?: number;
  slippageBps?: number;
}): { expectedOut: string; minAmountOut: string; slippageBps: number } {
  const tokenDecimals = args.tokenDecimals ?? 6;
  const usdcDecimals = args.usdcDecimals ?? 6;
  const slippageBps = args.slippageBps ?? 100;
  if (slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error(`quoteSpotOut: slippageBps out of range: ${slippageBps}`);
  }
  if (!/^\d+(\.\d+)?$/.test(args.amountUsdc)) {
    throw new Error(`quoteSpotOut: invalid amountUsdc: ${args.amountUsdc}`);
  }
  const priceRaw = BigInt(args.priceRaw);
  if (priceRaw <= 0n) throw new Error("quoteSpotOut: priceRaw must be > 0");

  const [whole, frac = ""] = args.amountUsdc.split(".");
  const amountUsdcAtomic =
    BigInt(whole) * 10n ** BigInt(usdcDecimals) +
    BigInt((frac + "0".repeat(usdcDecimals)).slice(0, usdcDecimals));

  const exp = tokenDecimals - usdcDecimals - args.expo;
  const expectedOut =
    exp >= 0
      ? (amountUsdcAtomic * 10n ** BigInt(exp)) / priceRaw
      : amountUsdcAtomic / (priceRaw * 10n ** BigInt(-exp));
  const minAmountOut = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return {
    expectedOut: expectedOut.toString(),
    minAmountOut: minAmountOut.toString(),
    slippageBps,
  };
}

export function buildVenueSpotTypedData(args: {
  chainId: number;
  verifyingContract: Address;
  request: VenueSpotRequest;
  nonce: bigint;
}) {
  return {
    domain: {
      ...VENUE_EIP712_DOMAIN,
      chainId: args.chainId,
      verifyingContract: args.verifyingContract,
    },
    types: VENUE_SPOT_REQUEST_TYPES,
    primaryType: "SpotRequest" as const,
    message: typedDataMessage(args.request, args.nonce),
  };
}

export function encodeUnsignedVenueSpotRequest(request: VenueSpotRequest): Hex {
  return encodeFunctionData({
    abi: buFxVenueRequestRouterAbi,
    functionName: "requestSpot",
    args: [request],
  });
}

export function encodeSignedVenueSpotRequest(args: {
  request: VenueSpotRequest;
  nonce: bigint;
  signature: Hex;
}): Hex {
  return encodeFunctionData({
    abi: buFxVenueRequestRouterAbi,
    functionName: "requestSpotWithSignature",
    args: [args.request, args.nonce, args.signature],
  });
}

export function routeIdForSpotSymbol(symbol: SpotFxSymbol): Hex {
  return SPOT_FX_ROUTES[symbol].routeId;
}

export function mintToHubRouteId(sourceChainId: 43113 | 5042002): Hex {
  return sourceChainId === 43113
    ? LIVE_ROUTE_IDS.fujiToArcMintToHubUsdc
    : LIVE_ROUTE_IDS.arcToFujiMintToHubUsdc;
}

function typedDataMessage(request: VenueSpotRequest, nonce: bigint) {
  return {
    marketId: request.marketId,
    trader: request.trader,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    minAmountOut: request.minAmountOut,
    maxExecutionFee: request.maxExecutionFee,
    deadline: request.deadline,
    referrer: request.referrer,
    campaignId: request.campaignId,
    dataHash: keccak256(request.data),
    nonce,
  };
}

function normalizeAddress(value: string): Address {
  if (!isAddress(value)) throw new Error(`invalid address: ${value}`);
  return value as Address;
}
