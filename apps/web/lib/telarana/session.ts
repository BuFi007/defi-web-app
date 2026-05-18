/**
 * Reuse the same wallet-session pattern the perps agent uses so a single
 * signed session covers both perps and telarana. The wallet-session
 * middleware in apps/api accepts both EIP-712 typed-data and personal_sign
 * — we always issue typed-data here.
 */
import type { Hex } from "viem";

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_REFRESH_SKEW = 60;

export interface TelaranaWalletSessionTypedData {
  domain: { name: "BUFX Telarana"; version: "1"; chainId: number };
  types: { WalletSession: Array<{ name: string; type: string }> };
  primaryType: "WalletSession";
  message: {
    purpose: string;
    wallet: `0x${string}`;
    chainId: bigint;
    origin: string;
    iat: bigint;
    exp: bigint;
  };
}

export interface TelaranaWalletSessionProof {
  address: `0x${string}`;
  chainId: number;
  message: string;
  signature: Hex;
  iat: number;
  exp: number;
  typedData: TelaranaWalletSessionTypedData;
}

export function buildTelaranaSessionTypedData(args: {
  address: `0x${string}`;
  chainId: number;
  now?: number;
  origin?: string;
}): { typedData: TelaranaWalletSessionTypedData; iat: number; exp: number; message: string } {
  const iat = args.now ?? Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const origin =
    args.origin ??
    (typeof window !== "undefined" ? window.location.origin : "https://bufi.finance");
  const purpose =
    "Authorize the FX money-market UI to read your positions and submit signed " +
    "intents on your behalf for the next 12 hours. No funds move.";

  const typedData: TelaranaWalletSessionTypedData = {
    domain: { name: "BUFX Telarana", version: "1", chainId: args.chainId },
    types: {
      WalletSession: [
        { name: "purpose", type: "string" },
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "origin", type: "string" },
        { name: "iat", type: "uint256" },
        { name: "exp", type: "uint256" },
      ],
    },
    primaryType: "WalletSession",
    message: {
      purpose,
      wallet: args.address,
      chainId: BigInt(args.chainId),
      origin,
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  };

  const message = `BUFX Telarana session;wallet:${args.address};chainId:${args.chainId};iat:${iat};exp:${exp}`;
  return { typedData, iat, exp, message };
}

interface CachedSession {
  address: string;
  chainId: number;
  message: string;
  signature: Hex;
  iat: number;
  exp: number;
  typedData: {
    domain: TelaranaWalletSessionTypedData["domain"];
    types: TelaranaWalletSessionTypedData["types"];
    primaryType: TelaranaWalletSessionTypedData["primaryType"];
    message: {
      purpose: string;
      wallet: `0x${string}`;
      chainId: string;
      origin: string;
      iat: string;
      exp: string;
    };
  };
}

function storageKey(address: string, chainId: number): string {
  return `telarana:wallet-session:${address.toLowerCase()}:${chainId}`;
}

export function readCachedSession(
  address: string,
  chainId: number,
): TelaranaWalletSessionProof | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey(address, chainId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedSession;
    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp <= now + SESSION_REFRESH_SKEW) return null;
    if (parsed.address.toLowerCase() !== address.toLowerCase()) return null;
    if (parsed.chainId !== chainId) return null;
    return {
      address: parsed.address as `0x${string}`,
      chainId: parsed.chainId,
      message: parsed.message,
      signature: parsed.signature,
      iat: parsed.iat,
      exp: parsed.exp,
      typedData: {
        domain: parsed.typedData.domain,
        types: parsed.typedData.types,
        primaryType: parsed.typedData.primaryType,
        message: {
          purpose: parsed.typedData.message.purpose,
          wallet: parsed.typedData.message.wallet,
          chainId: BigInt(parsed.typedData.message.chainId),
          origin: parsed.typedData.message.origin,
          iat: BigInt(parsed.typedData.message.iat),
          exp: BigInt(parsed.typedData.message.exp),
        },
      },
    };
  } catch {
    return null;
  }
}

export function writeCachedSession(proof: TelaranaWalletSessionProof): void {
  if (typeof window === "undefined") return;
  const serializable: CachedSession = {
    address: proof.address,
    chainId: proof.chainId,
    message: proof.message,
    signature: proof.signature,
    iat: proof.iat,
    exp: proof.exp,
    typedData: {
      domain: proof.typedData.domain,
      types: proof.typedData.types,
      primaryType: proof.typedData.primaryType,
      message: {
        purpose: proof.typedData.message.purpose,
        wallet: proof.typedData.message.wallet,
        chainId: proof.typedData.message.chainId.toString(),
        origin: proof.typedData.message.origin,
        iat: proof.typedData.message.iat.toString(),
        exp: proof.typedData.message.exp.toString(),
      },
    },
  };
  window.localStorage.setItem(storageKey(proof.address, proof.chainId), JSON.stringify(serializable));
}

export function sessionHeaders(proof: TelaranaWalletSessionProof) {
  return {
    "X-Wallet-Address": proof.address,
    "X-Wallet-ChainId": String(proof.chainId),
    "X-Wallet-Signature": proof.signature,
    "X-Wallet-TypedData": JSON.stringify({
      domain: proof.typedData.domain,
      types: proof.typedData.types,
      primaryType: proof.typedData.primaryType,
      message: {
        purpose: proof.typedData.message.purpose,
        wallet: proof.typedData.message.wallet,
        chainId: proof.typedData.message.chainId.toString(),
        origin: proof.typedData.message.origin,
        iat: proof.typedData.message.iat.toString(),
        exp: proof.typedData.message.exp.toString(),
      },
    }),
    "X-Wallet-Message": proof.message,
  };
}
