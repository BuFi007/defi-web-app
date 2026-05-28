// DEPRECATED — prefer apps/web/lib/dev-wallet + apps/web/lib/session.
//
// This file remains because lib/perps/hooks.ts + trade-island/panels.tsx
// still call getPerpsReplacementDevWallet() in 8+ places. Those will be
// migrated to useDevWallet() + useEnsureSession() in a follow-up sweep.
// Until then, this file produces a wallet IDENTICAL to what the unified
// DevWalletProvider produces (same env var, same private key, same chain),
// so co-existence is safe.
//
// New code: do NOT import from this file. Use:
//   import { useDevWallet } from "@/lib/dev-wallet"
//   import { useBufiAddress, useEnsureSession } from "@/lib/session"

import type { Hex } from "viem";
import {
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";

import type {
  PerpsReplacementPrepareResponse,
  WalletSessionTypedData,
} from "./replacement-agent";

const DEFAULT_PRIVATE_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_CHAIN_ID = 5042002;

export interface PerpsReplacementDevWallet {
  address: string;
  chainId: number;
  signMessage(message: string): Promise<Hex>;
  signTypedData(
    typedData: PerpsReplacementPrepareResponse["typedData"],
  ): Promise<Hex>;
  signSessionTypedData(typedData: WalletSessionTypedData): Promise<Hex>;
}

declare global {
  interface Window {
    __BUFX_PERPS_REPLACEMENT_E2E__?: {
      enabled: boolean;
      address?: string;
      chainId?: number;
      lastToast?: Record<string, unknown>;
      lastSubmitted?: Record<string, unknown>;
      lastError?: string;
    };
  }
}

export function getPerpsReplacementDevWallet(): PerpsReplacementDevWallet | null {
  if (process.env.NODE_ENV === "production") return null;
  const perpsOn = process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E === "1";
  const genericOn = process.env.NEXT_PUBLIC_DEV_WALLET === "1";
  if (!perpsOn && !genericOn) return null;

  const privateKey =
    process.env.NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY ??
    process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_PRIVATE_KEY ??
    DEFAULT_PRIVATE_KEY;
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(
      "NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_PRIVATE_KEY must be a 32-byte hex private key",
    );
  }

  const chainId = Number(
    process.env.NEXT_PUBLIC_DEV_WALLET_CHAIN_ID ??
      process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_CHAIN_ID ??
      DEFAULT_CHAIN_ID,
  );
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(
      "NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_CHAIN_ID must be a positive integer",
    );
  }

  const account = privateKeyToAccount(privateKey as Hex);
  return {
    address: account.address,
    chainId,
    signMessage(message) {
      return account.signMessage({ message });
    },
    signTypedData(typedData) {
      return signTypedData(account, typedData);
    },
    signSessionTypedData(typedData) {
      return account.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    },
  };
}

export function publishPerpsReplacementE2eState(
  patch: NonNullable<Window["__BUFX_PERPS_REPLACEMENT_E2E__"]>,
): void {
  if (process.env.NODE_ENV === "production") return;
  if (
    process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E !== "1" &&
    process.env.NEXT_PUBLIC_DEV_WALLET !== "1"
  ) {
    return;
  }
  if (typeof window === "undefined") return;

  window.__BUFX_PERPS_REPLACEMENT_E2E__ = {
    ...window.__BUFX_PERPS_REPLACEMENT_E2E__,
    ...patch,
    enabled: true,
  };
  window.dispatchEvent(
    new CustomEvent("bufx:perps-replacement-e2e", {
      detail: window.__BUFX_PERPS_REPLACEMENT_E2E__,
    }),
  );
}

function signTypedData(
  account: PrivateKeyAccount,
  typedData: PerpsReplacementPrepareResponse["typedData"],
): Promise<Hex> {
  return account.signTypedData({
    ...typedData,
    primaryType: typedData.primaryType as "SignedOrder",
    message: {
      ...typedData.message,
      sizeDeltaE18: BigInt(String(typedData.message.sizeDeltaE18)),
      priceE18: BigInt(String(typedData.message.priceE18)),
      nonce: BigInt(String(typedData.message.nonce)),
      deadline: BigInt(String(typedData.message.deadline)),
    },
  } as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
}
