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
