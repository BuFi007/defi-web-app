/**
 * Wallet-session middleware. Verifies a signed-message header and
 * attaches the parsed session to the Hono context. Pattern:
 *   X-Wallet-Address: 0x...
 *   X-Wallet-ChainId: 43113
 *   X-Wallet-Message: <utf8>
 *   X-Wallet-Signature: 0x...
 *
 * The frontend signs a SIWE-ish challenge once per session and replays
 * these headers on every authed request. This is the wallet-native
 * replacement for Clerk sessions in the Sendero reference.
 */

import type { Context, MiddlewareHandler } from "hono";
import { isAddress, recoverMessageAddress, type Address, type Hex } from "viem";

import type { WalletSession } from "@bufi/shared-types";

declare module "hono" {
  interface ContextVariableMap {
    walletSession: WalletSession | null;
  }
}

const SUPPORTED_CHAIN_IDS = new Set([43113, 919, 5042002]);

export interface WalletSessionOptions {
  /** If true, request fails with 401 when no valid session header is present. */
  required?: boolean;
  /** Seconds — reject sessions issued more than this long ago. Default 24h. */
  maxAgeSeconds?: number;
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
  const message = c.req.header("X-Wallet-Message");
  const signature = c.req.header("X-Wallet-Signature");
  if (!addr || !chainHeader || !message || !signature) return null;
  if (!isAddress(addr)) return null;
  const chainId = Number(chainHeader);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) return null;

  // Message must contain `iat:<unix>` field so we can enforce maxAge.
  const iatMatch = /iat:(\d+)/.exec(message);
  const iat = iatMatch ? Number(iatMatch[1]) : 0;
  const now = Math.floor(Date.now() / 1000);
  if (!iat || now - iat > maxAgeSeconds) return null;
  const expMatch = /exp:(\d+)/.exec(message);
  const exp = expMatch ? Number(expMatch[1]) : iat + maxAgeSeconds;
  if (now > exp) return null;

  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return null;
  }
  if (recovered.toLowerCase() !== addr.toLowerCase()) return null;

  return {
    address: addr as Address,
    chainId: chainId as WalletSession["chainId"],
    proof: { message, signature: signature as Hex, iat, exp },
  };
}
