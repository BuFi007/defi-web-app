/**
 * Wallet-session middleware. Verifies a signed-message header and
 * attaches the parsed session to the Hono context. Two transports:
 *
 *   New (EIP-712 typed data, preferred for browser UX):
 *     X-Wallet-Address: 0x...
 *     X-Wallet-ChainId: 43113
 *     X-Wallet-TypedData: <JSON of { domain, types, primaryType, message }>
 *     X-Wallet-Signature: 0x...
 *
 *   Legacy (personal_sign, used by e2e scripts and existing cached sessions):
 *     X-Wallet-Address: 0x...
 *     X-Wallet-ChainId: 43113
 *     X-Wallet-Message: <utf8>
 *     X-Wallet-Signature: 0x...
 *
 * Both paths must produce iat/exp markers (typed-data fields or `iat:<n>`
 * / `exp:<n>` substrings) so this middleware can enforce session age.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  createPublicClient,
  hashMessage,
  hashTypedData,
  http,
  isAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";

import { getRpcUrl } from "@bufi/contracts";
import type { ChainId, WalletSession } from "@bufi/shared-types";

declare module "hono" {
  interface ContextVariableMap {
    walletSession: WalletSession | null;
  }
}

const SUPPORTED_CHAIN_IDS = new Set([43113, 919, 5042002]);

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

async function verifyErc1271Signature(
  chainId: number,
  walletAddress: Address,
  hash: Hex,
  signature: Hex,
): Promise<boolean> {
  const client = getPublicClient(chainId);
  if (!client) return false;
  try {
    const result = await client.readContract({
      address: walletAddress,
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [hash, signature],
    });
    return result === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

export interface WalletSessionOptions {
  /** If true, request fails with 401 when no valid session header is present. */
  required?: boolean;
  /** Seconds — reject sessions issued more than this long ago. Default 24h. */
  maxAgeSeconds?: number;
}

interface SessionTimestamps {
  iat: number;
  exp: number;
}

interface WalletSessionTypedDataPayload {
  domain: { name: string; version: string; chainId: number };
  types: { WalletSession: Array<{ name: string; type: string }> };
  primaryType: "WalletSession";
  message: {
    purpose: string;
    wallet: `0x${string}`;
    chainId: string;
    origin: string;
    iat: string;
    exp: string;
  };
}

export function walletSession(opts: WalletSessionOptions = {}): MiddlewareHandler {
  const maxAge = opts.maxAgeSeconds ?? 86_400;
  return async (c, next) => {
    const session = await readSession(c, maxAge);
    if (opts.required && !session) {
      return c.json({ error: "wallet session required" }, 401);
    }
    c.set("walletSession", session);
    await next();
  };
}

async function readSession(c: Context, maxAgeSeconds: number): Promise<WalletSession | null> {
  const addr = c.req.header("X-Wallet-Address");
  const chainHeader = c.req.header("X-Wallet-ChainId");
  const signature = c.req.header("X-Wallet-Signature");
  const typedDataHeader = c.req.header("X-Wallet-TypedData");
  const message = c.req.header("X-Wallet-Message");
  if (!addr || !chainHeader || !signature) return null;
  if (!isAddress(addr)) return null;
  const chainId = Number(chainHeader);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) return null;

  let recovered: Address | null = null;
  let timestamps: SessionTimestamps | null = null;
  let proofMessage = message ?? "";
  let messageHash: Hex | null = null;

  if (typedDataHeader) {
    const parsedTyped = parseTypedData(typedDataHeader);
    if (!parsedTyped) return null;
    timestamps = enforceWindow(
      Number(parsedTyped.message.iat),
      Number(parsedTyped.message.exp),
      maxAgeSeconds
    );
    if (!timestamps) return null;
    if (parsedTyped.message.wallet.toLowerCase() !== addr.toLowerCase()) return null;
    if (Number(parsedTyped.message.chainId) !== chainId) return null;

    const typedDataArgs = {
      domain: parsedTyped.domain,
      types: parsedTyped.types,
      primaryType: "WalletSession" as const,
      message: {
        purpose: parsedTyped.message.purpose,
        wallet: parsedTyped.message.wallet,
        chainId: BigInt(parsedTyped.message.chainId),
        origin: parsedTyped.message.origin,
        iat: BigInt(parsedTyped.message.iat),
        exp: BigInt(parsedTyped.message.exp),
      },
    };

    try {
      recovered = await recoverTypedDataAddress({
        ...typedDataArgs,
        signature: signature as Hex,
      });
    } catch {
      return null;
    }
    messageHash = hashTypedData(typedDataArgs);
    proofMessage = proofMessage || typedDataHeader;
  } else if (message) {
    timestamps = parseLegacyTimestamps(message, maxAgeSeconds);
    if (!timestamps) return null;
    try {
      recovered = await recoverMessageAddress({ message, signature: signature as Hex });
    } catch {
      return null;
    }
    messageHash = hashMessage(message);
  } else {
    return null;
  }

  const eoaMatch = recovered && recovered.toLowerCase() === addr.toLowerCase();
  if (!eoaMatch) {
    if (!messageHash) return null;
    const valid = await verifyErc1271Signature(
      chainId,
      addr as Address,
      messageHash,
      signature as Hex,
    );
    if (!valid) return null;
  }

  return {
    address: addr as Address,
    chainId: chainId as WalletSession["chainId"],
    proof: {
      message: proofMessage,
      signature: signature as Hex,
      iat: timestamps.iat,
      exp: timestamps.exp,
    },
  };
}

function parseTypedData(raw: string): WalletSessionTypedDataPayload | null {
  try {
    const parsed = JSON.parse(raw) as WalletSessionTypedDataPayload;
    if (parsed.primaryType !== "WalletSession") return null;
    if (!parsed.domain || !parsed.types?.WalletSession || !parsed.message) return null;
    if (!parsed.message.iat || !parsed.message.exp) return null;
    if (!parsed.message.wallet || !parsed.message.chainId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseLegacyTimestamps(message: string, maxAgeSeconds: number): SessionTimestamps | null {
  const iatMatch = /iat:(\d+)/.exec(message);
  const iat = iatMatch ? Number(iatMatch[1]) : 0;
  const expMatch = /exp:(\d+)/.exec(message);
  const exp = expMatch ? Number(expMatch[1]) : iat + maxAgeSeconds;
  return enforceWindow(iat, exp, maxAgeSeconds);
}

function enforceWindow(iat: number, exp: number, maxAgeSeconds: number): SessionTimestamps | null {
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (!iat) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - iat > maxAgeSeconds) return null;
  if (now > exp) return null;
  return { iat, exp };
}
