import { z } from "zod";
import { livePerpsMarkets, signedSizeDelta } from "@bufi/perps";

export const ARC_CHAIN_ID = 5042002;

export const PERP_SYMBOLS = ["EURC/USDC", "tJPYC/USDC", "MXNB/USDC", "CIRBTC/USDC", "AUDF/USDC"] as const;

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

// -- Zod primitives --

export const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const zAmount = z.string().regex(/^\d+(\.\d{1,6})?$/).refine(
  (v) => parseFloat(v) > 0,
  { message: "amount must be greater than zero" },
);
export const zUint = z.string().regex(/^\d+$/);
export const zSymbol = z.enum(PERP_SYMBOLS);
export const zSide = z.enum(["long", "short"]);
export const zSignature = z.string().regex(/^0x[a-fA-F0-9]+$/);
export const zLeverage = z.number().int().min(1).max(50).default(1);

// -- Helpers --

export function resolveMarketId(symbol: string): string | null {
  const markets = livePerpsMarkets(ARC_CHAIN_ID);
  return markets.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase())?.marketId ?? null;
}

export function computeSizeDelta(side: "long" | "short", sizeUsdc: string): string {
  return signedSizeDelta({ side, sizeUsdc }).toString();
}

let _nonceCounter = 0;

export function generateDeadlineAndNonce(ttl = 3600) {
  _nonceCounter = (_nonceCounter + 1) % 1_000_000;
  return {
    deadline: Math.floor(Date.now() / 1000) + ttl,
    nonce: `${Date.now()}${String(_nonceCounter).padStart(6, "0")}`,
  };
}

export function withEip712Domain<T extends { types: Record<string, readonly { name: string; type: string }[]> }>(
  typedData: T,
) {
  return { ...typedData, types: { EIP712Domain: EIP712_DOMAIN_TYPE, ...typedData.types } };
}
