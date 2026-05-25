import { loadContracts, getRpcUrl } from "@bufi/contracts";
import type { ChainId } from "@bufi/shared-types";
import {
  createPublicClient,
  hashTypedData,
  http,
  isAddress,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

import type { PerpsIntentRequest } from "./schemas";

const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

const ERC1271_ABI = [
  {
    name: "isValidSignature",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes4" }],
  },
] as const;

const clientCache = new Map<number, ReturnType<typeof createPublicClient>>();

function getPublicClient(chainId: number) {
  let client = clientCache.get(chainId);
  if (!client) {
    const rpcUrl = getRpcUrl(chainId as ChainId);
    if (!rpcUrl) return null;
    client = createPublicClient({ transport: http(rpcUrl) });
    clientCache.set(chainId, client);
  }
  return client;
}

export const PERPS_ORDER_DOMAIN = {
  name: "TelaranaFxOrderSettlement",
  version: "1",
} as const;

// Field order + types must match `SIGNED_ORDER_TYPEHASH` in
// fx-telarana/contracts/src/perp/FxOrderSettlement.sol:33-34 byte for
// byte. Drift here → on-chain signature recovery returns the wrong
// address → settleMatch reverts with `InvalidSignature(trader)`.
// Specifically, `maxFee` is the 5th field on the contract and on the
// Rust matcher (crates/matcher-types/src/eip712.rs); omitting it is a
// silent integration bug.
export const SIGNED_ORDER_TYPES = {
  SignedOrder: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "sizeDeltaE18", type: "int256" },
    { name: "priceE18", type: "uint256" },
    { name: "maxFee", type: "uint256" },
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
  // 0n today — keeper hard-codes maxFee=0 on settleMatch (uncapped fee).
  // Kept in the typed-data so the digest matches the on-chain typehash
  // even when the upstream order shape gains a real fee cap.
  maxFee: bigint;
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
    // Hard-coded 0n — the matcher's intent_translator (Rust) and the
    // existing TS keeper both reconstruct with maxFee=0; the on-chain
    // contract treats 0 as "no cap." When upstream gains a real fee
    // cap, plumb it through PerpsOrderTypedDataInput and update both
    // sides simultaneously.
    maxFee: 0n,
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
  const typedData = buildPerpsOrderTypedData(req);
  const eoaValid = await verifyTypedData({
    ...typedData,
    address: req.trader as Address,
    signature: req.signature as Hex,
  });
  if (eoaValid) return true;
  // ERC-1271 fallback for smart contract wallets (Circle agent wallets)
  const client = getPublicClient(req.chainId);
  if (!client) return false;
  try {
    const hash = hashTypedData(typedData);
    const result = await client.readContract({
      address: req.trader as Address,
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [hash, req.signature as Hex],
    });
    return result === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
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
