import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// Distinct from the perps dev key (0xaaaa…) so the two surfaces can be
// driven independently in the same browser session without colliding
// X-Wallet-Address headers on the API.
const DEFAULT_PRIVATE_KEY =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DEFAULT_CHAIN_ID = 5042002;

export interface BentoSessionTypedData {
  domain: { name: string; version: string; chainId: number };
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface BentoDevWallet {
  address: `0x${string}`;
  chainId: number;
  signMessage(message: string): Promise<Hex>;
  signSessionTypedData(typedData: BentoSessionTypedData): Promise<Hex>;
}

let cachedAccount: PrivateKeyAccount | null = null;
let cachedWallet: BentoDevWallet | null = null;

// Lives in dev only and only when the operator explicitly opts in via
// `NEXT_PUBLIC_BENTO_E2E=1`. When active, multiplayer.tsx falls back to
// this wallet's address instead of wagmi's `useAccount`, and the commit /
// reveal / claim paths POST directly to the dev simulator endpoints
// instead of broadcasting via wagmi.
//
// To override the private key, set `NEXT_PUBLIC_BENTO_E2E_PRIVATE_KEY`.
// To override the chain, set `NEXT_PUBLIC_BENTO_E2E_CHAIN_ID`.
export function getBentoDevWallet(): BentoDevWallet | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.NEXT_PUBLIC_BENTO_E2E !== "1") return null;

  if (cachedWallet) return cachedWallet;

  const privateKey =
    process.env.NEXT_PUBLIC_BENTO_E2E_PRIVATE_KEY ?? DEFAULT_PRIVATE_KEY;
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(
      "NEXT_PUBLIC_BENTO_E2E_PRIVATE_KEY must be a 32-byte hex private key",
    );
  }
  const chainId = Number(
    process.env.NEXT_PUBLIC_BENTO_E2E_CHAIN_ID ?? DEFAULT_CHAIN_ID,
  );
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  cachedAccount = account;
  cachedWallet = {
    address: account.address,
    chainId,
    async signMessage(message) {
      return account.signMessage({ message });
    },
    async signSessionTypedData(typedData) {
      return account.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    },
  };
  return cachedWallet;
}

// Test hook — lets the smoke / e2e harness reset the cached wallet
// between scenarios. Not used in production code paths.
export function __resetBentoDevWalletForTests(): void {
  cachedAccount = null;
  cachedWallet = null;
}
