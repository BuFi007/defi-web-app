/**
 * Builders for the wallet-session signing payload — both the EIP-712
 * typed-data flavor (preferred) and the legacy plain-text fallback.
 *
 * Pure functions, no React, no wagmi. The three signing surfaces
 * (useEnsureSession, useSessionSigner, telarana ensureSession) all
 * route through these so the wallet popup shows IDENTICAL text in
 * every flow.
 */

import {
  SESSION_TTL_HOURS,
  SESSION_TTL_SECONDS,
  type WalletSessionHeaders,
  type WalletSessionProof,
  type WalletSessionTypedData,
} from "./types";

/** Human-friendly chain label rendered into the wallet prompt. Falls
 *  back to "Chain <id>" so a new chain doesn't show a blank in MM. */
const CHAIN_NAMES: Record<number, string> = {
  43113: "Avalanche Fuji",
  919: "Mode Sepolia",
  5042002: "Arc Testnet",
};

function formatUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

function resolveOrigin(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://bufi.finance";
}

/**
 * Plain-text personal_sign body. The backend's regex
 * (apps/api/src/wallet-session.ts) only requires `iat:<n>` and
 * `exp:<n>` markers to appear; the rest is human-readable for the
 * wallet popup.
 */
export function buildWalletSessionMessage(args: {
  address: string;
  chainId: number;
  now?: number;
  origin?: string;
}): { message: string; iat: number; exp: number } {
  const iat = args.now ?? Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const chainName = CHAIN_NAMES[args.chainId] ?? `Chain ${args.chainId}`;
  const origin = resolveOrigin(args.origin);
  const issuedHuman = formatUtc(iat);
  const expiresHuman = formatUtc(exp);

  const message = [
    "BUFX Perps · Keeper Session",
    "",
    `Sign in to authorize BUFX to replace your perp orders on your behalf for the next ${SESSION_TTL_HOURS} hours.`,
    "This signature does NOT move funds and grants no spending authority.",
    "",
    `Wallet:   ${args.address}`,
    `Network:  ${chainName} (${args.chainId})`,
    `Origin:   ${origin}`,
    `Issued:   ${issuedHuman} (iat:${iat})`,
    `Expires:  ${expiresHuman} (exp:${exp})`,
  ].join("\n");

  return { iat, exp, message };
}

/**
 * EIP-712 typed-data payload. Preferred over personal_sign because
 * MetaMask renders the structured fields in a nicer UI. The returned
 * `message` is the legacy plain-text body — keep it around so backend
 * cached sessions and the personal_sign rollout path still resolve.
 */
export function buildWalletSessionTypedData(args: {
  address: `0x${string}`;
  chainId: number;
  now?: number;
  origin?: string;
}): {
  typedData: WalletSessionTypedData;
  iat: number;
  exp: number;
  message: string;
} {
  const iat = args.now ?? Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const origin = resolveOrigin(args.origin);
  const purpose =
    `Authorize BUFX to replace your perp orders on your behalf for ${SESSION_TTL_HOURS} hours. ` +
    `No funds move and no spending authority is granted.`;

  const typedData: WalletSessionTypedData = {
    domain: { name: "BUFX Perps", version: "1", chainId: args.chainId },
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

  const message =
    `BUFX Perps session;wallet:${args.address};chainId:${args.chainId};iat:${iat};exp:${exp}`;

  return { typedData, iat, exp, message };
}

/**
 * HTTP headers for an authenticated request. The proof is serialised
 * across four (or five, when typedData is present) headers so the
 * backend can reconstruct the exact payload that was signed without
 * trusting the client to re-derive it.
 */
export function walletSessionHeaders(
  proof: WalletSessionProof,
): WalletSessionHeaders {
  const headers: WalletSessionHeaders = {
    "X-Wallet-Address": proof.address,
    "X-Wallet-ChainId": String(proof.chainId),
    "X-Wallet-Message": proof.message,
    "X-Wallet-Signature": proof.signature,
  };
  if (proof.typedData) {
    headers["X-Wallet-TypedData"] = serializeWalletSessionTypedData(proof.typedData);
  }
  return headers;
}

// JSON-safe form: bigints become decimal strings so the payload round-trips
// through JSON.stringify / JSON.parse without precision loss.
interface JsonSafeTypedData {
  domain: WalletSessionTypedData["domain"];
  types: WalletSessionTypedData["types"];
  primaryType: WalletSessionTypedData["primaryType"];
  message: {
    purpose: string;
    wallet: `0x${string}`;
    chainId: string;
    origin: string;
    iat: string;
    exp: string;
  };
}

export function toJsonSafeTypedData(
  typedData: WalletSessionTypedData,
): JsonSafeTypedData {
  return {
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: {
      purpose: typedData.message.purpose,
      wallet: typedData.message.wallet,
      chainId: typedData.message.chainId.toString(),
      origin: typedData.message.origin,
      iat: typedData.message.iat.toString(),
      exp: typedData.message.exp.toString(),
    },
  };
}

export function fromJsonSafeTypedData(
  raw: JsonSafeTypedData,
): WalletSessionTypedData {
  return {
    domain: raw.domain,
    types: raw.types,
    primaryType: raw.primaryType,
    message: {
      purpose: raw.message.purpose,
      wallet: raw.message.wallet,
      chainId: BigInt(raw.message.chainId),
      origin: raw.message.origin,
      iat: BigInt(raw.message.iat),
      exp: BigInt(raw.message.exp),
    },
  };
}

export function serializeWalletSessionTypedData(
  typedData: WalletSessionTypedData,
): string {
  return JSON.stringify(toJsonSafeTypedData(typedData));
}

export type { JsonSafeTypedData };
