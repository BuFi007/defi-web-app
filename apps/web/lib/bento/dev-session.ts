import type { Hex } from "viem";

import { getBentoDevWallet } from "./dev-mock-wallet";

export interface BentoDevSessionHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-TypedData": string;
  "X-Wallet-Signature": string;
}

interface CachedSession {
  headers: BentoDevSessionHeaders;
  exp: number; // unix seconds
}

let cached: CachedSession | null = null;

// Build the X-Wallet-* headers that satisfy apps/api/src/wallet-session.ts
// for dev mock requests. Signs the same BUFX Wallet Session typed-data
// the production wallet does, just with the deterministic dev key.
//
// Returns null when the BENTO_E2E shim is not enabled. Caches the
// headers for the session lifetime (24h) — refreshing the signature on
// every request would defeat the purpose of a typed-data session token.
export async function buildBentoDevSessionHeaders(): Promise<
  BentoDevSessionHeaders | null
> {
  const wallet = getBentoDevWallet();
  if (!wallet) return null;

  const now = Math.floor(Date.now() / 1000);
  // Refresh ~1h before expiry so a long-running browser session doesn't
  // get a 401 between two API calls.
  if (cached && cached.exp - 3600 > now) {
    return cached.headers;
  }

  const iat = now;
  const exp = iat + 86_400;
  const typedData = {
    domain: {
      name: "BUFX Wallet Session",
      version: "1",
      chainId: wallet.chainId,
    },
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
    primaryType: "WalletSession" as const,
    message: {
      purpose: "bufi.bento.e2e",
      wallet: wallet.address,
      chainId: BigInt(wallet.chainId),
      origin: typeof window !== "undefined" ? window.location.origin : "node",
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  } as const;

  const signature: Hex = await wallet.signSessionTypedData({
    domain: typedData.domain,
    types: typedData.types as unknown as Record<
      string,
      ReadonlyArray<{ name: string; type: string }>
    >,
    primaryType: typedData.primaryType,
    message: typedData.message as unknown as Record<string, unknown>,
  });

  const wire = JSON.stringify({
    ...typedData,
    message: {
      ...typedData.message,
      chainId: String(wallet.chainId),
      iat: String(iat),
      exp: String(exp),
    },
  });

  cached = {
    headers: {
      "X-Wallet-Address": wallet.address,
      "X-Wallet-ChainId": String(wallet.chainId),
      "X-Wallet-TypedData": wire,
      "X-Wallet-Signature": signature,
    },
    exp,
  };
  return cached.headers;
}

export function __resetBentoDevSessionForTests(): void {
  cached = null;
}
