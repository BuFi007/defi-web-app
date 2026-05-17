import { loadContracts } from "@bufi/contracts";
import type { ChainId } from "@bufi/shared-types";
import {
  hashTypedData,
  isAddress,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

import type { PerpsIntentRequest } from "./schemas";

export const PERPS_ORDER_DOMAIN = {
  name: "TelaranaFxOrderSettlement",
  version: "1",
} as const;

export const SIGNED_ORDER_TYPES = {
  SignedOrder: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "sizeDeltaE18", type: "int256" },
    { name: "priceE18", type: "uint256" },
    { name: "orderType", type: "uint8" },
    { name: "flags", type: "uint8" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const PERPS_ORDER_TYPES = SIGNED_ORDER_TYPES;

export type PerpsOrderKind = "market" | "limit";

export interface PerpsOrderTypedDataInput {
  chainId: ChainId;
  trader: string;
  marketId: string;
  side: "long" | "short";
  orderType: PerpsOrderKind;
  sizeUsdc: string;
  sizeDelta?: string;
  leverage: number;
  limitPrice?: string;
  priceE18?: string;
  reduceOnly: boolean;
  postOnly?: boolean;
  nonce: string;
  deadline: number;
}

export interface SignedOrderMessage {
  trader: Address;
  marketId: Hex;
  sizeDeltaE18: bigint;
  priceE18: bigint;
  orderType: number;
  flags: number;
  nonce: bigint;
  deadline: bigint;
}

export interface PerpsTypedData {
  domain: TypedDataDomain;
  types: typeof SIGNED_ORDER_TYPES;
  primaryType: "SignedOrder";
  message: SignedOrderMessage;
}

export function buildPerpsOrderTypedData(req: PerpsOrderTypedDataInput): PerpsTypedData {
  const verifyingContract = loadContracts()[req.chainId].perps.orderSettlement;
  if (!verifyingContract) {
    throw new Error(`perps order settlement is not configured for chain ${req.chainId}`);
  }
  return {
    domain: {
      ...PERPS_ORDER_DOMAIN,
      chainId: req.chainId,
      verifyingContract,
    },
    types: SIGNED_ORDER_TYPES,
    primaryType: "SignedOrder",
    message: buildSignedOrderMessage(req),
  };
}

export function buildSignedOrderMessage(req: PerpsOrderTypedDataInput): SignedOrderMessage {
  if (!isAddress(req.trader)) throw new Error(`invalid trader address: ${req.trader}`);
  if (!isBytes32(req.marketId)) throw new Error(`invalid perps marketId bytes32: ${req.marketId}`);
  const nonce = BigInt(req.nonce);
  const deadline = BigInt(req.deadline);
  assertUint64(nonce, "nonce");
  assertUint64(deadline, "deadline");
  return {
    trader: req.trader as Address,
    marketId: req.marketId as Hex,
    sizeDeltaE18: signedSizeDelta(req),
    priceE18: BigInt(req.priceE18 ?? req.limitPrice ?? "0"),
    orderType: orderTypeCode(req.orderType),
    flags: orderFlags(req),
    nonce,
    deadline,
  };
}

export function hashPerpsOrder(req: PerpsOrderTypedDataInput): Hex {
  return hashTypedData(buildPerpsOrderTypedData(req));
}

export async function verifyPerpsOrderSignature(req: PerpsIntentRequest): Promise<boolean> {
  return verifyTypedData({
    ...buildPerpsOrderTypedData(req),
    address: req.trader as Address,
    signature: req.signature as Hex,
  });
}

export function signedSizeDelta(req: Pick<PerpsOrderTypedDataInput, "side" | "sizeDelta" | "sizeUsdc">): bigint {
  if (req.sizeDelta !== undefined) {
    const value = BigInt(req.sizeDelta);
    if (value === 0n) throw new Error("sizeDelta must be nonzero");
    return value;
  }
  const magnitude = parseUsdcToAtomic(req.sizeUsdc);
  if (magnitude === 0n) throw new Error("sizeUsdc must be nonzero");
  return req.side === "long" ? magnitude : -magnitude;
}

export function orderTypeCode(orderType: PerpsOrderKind): number {
  return orderType === "market" ? 0 : 1;
}

export function orderFlags(req: Pick<PerpsOrderTypedDataInput, "reduceOnly" | "postOnly">): number {
  return (req.reduceOnly ? 1 : 0) | (req.postOnly ? 2 : 0);
}

export function parseUsdcToAtomic(value: string): bigint {
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded || "0");
}

function assertUint64(value: bigint, label: string): void {
  if (value < 0n || value > 18_446_744_073_709_551_615n) {
    throw new Error(`${label} exceeds uint64`);
  }
}

function isBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}
