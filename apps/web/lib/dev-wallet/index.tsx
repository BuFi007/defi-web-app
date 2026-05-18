"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Hex } from "viem";
import {
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";

/**
 * Single dev-wallet shim that replaces all three legacy implementations:
 *   - apps/web/lib/perps/dev-mock-wallet.ts  (PERPS_REPLACEMENT_E2E)
 *   - apps/web/lib/bento/dev-mock-wallet.ts  (BENTO_E2E)
 *   - apps/web/lib/bento/dev-session.ts      (BENTO_E2E session headers)
 *
 * When ANY of `NEXT_PUBLIC_BENTO_E2E=1`, `NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1`,
 * or `NEXT_PUBLIC_DEV_WALLET=1` is set, this provider registers a
 * deterministic in-memory account and exposes it via useDevWallet().
 *
 * The provider does NOT push to the session store directly — that's
 * SessionBridge's job. This keeps the source-of-truth ordering explicit:
 *   DevWalletProvider mounts → useDevWallet() returns account →
 *   SessionBridge sees it on next render → store.setIdentity({source: "dev-mock"}).
 */

export interface DevWallet {
  account: PrivateKeyAccount;
  address: `0x${string}`;
  chainId: number;
  /** Sign a typed-data message. Used by useEnsureSession + per-flow signs. */
  signTypedData: PrivateKeyAccount["signTypedData"];
  signSessionTypedData: (typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
  signMessage: (message: string) => Promise<Hex>;
}

const DevWalletContext = createContext<DevWallet | null>(null);

// Distinct per-surface defaults so two devs running both shims at once
// don't collide on X-Wallet-Address headers in API logs. If the operator
// sets NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY explicitly it overrides both.
const PERPS_DEFAULT_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BENTO_DEFAULT_KEY =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DEFAULT_CHAIN_ID = 5042002;

function resolveConfig(): { privateKey: Hex; chainId: number } | null {
  if (process.env.NODE_ENV === "production") return null;

  const perpsOn = process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E === "1";
  const bentoOn = process.env.NEXT_PUBLIC_BENTO_E2E === "1";
  const generic = process.env.NEXT_PUBLIC_DEV_WALLET === "1";
  if (!perpsOn && !bentoOn && !generic) return null;

  const explicit =
    process.env.NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY ??
    process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_PRIVATE_KEY ??
    process.env.NEXT_PUBLIC_BENTO_E2E_PRIVATE_KEY;

  // Pick the default that matches whichever surface flag is on. If both
  // are on, perps wins (it was first historically).
  const privateKey = (explicit ??
    (perpsOn ? PERPS_DEFAULT_KEY : BENTO_DEFAULT_KEY)) as Hex;

  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(
      "NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY must be a 32-byte hex private key",
    );
  }

  const chainId = Number(
    process.env.NEXT_PUBLIC_DEV_WALLET_CHAIN_ID ??
      process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_CHAIN_ID ??
      process.env.NEXT_PUBLIC_BENTO_E2E_CHAIN_ID ??
      DEFAULT_CHAIN_ID,
  );
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("dev wallet chain id must be a positive integer");
  }

  return { privateKey, chainId };
}

export function DevWalletProvider({ children }: { children: ReactNode }) {
  const wallet = useMemo<DevWallet | null>(() => {
    const cfg = resolveConfig();
    if (!cfg) return null;
    const account = privateKeyToAccount(cfg.privateKey);
    return {
      account,
      address: account.address,
      chainId: cfg.chainId,
      signTypedData: account.signTypedData.bind(account),
      async signSessionTypedData(typedData) {
        return (await account.signTypedData({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        })) as Hex;
      },
      signMessage(message) {
        return account.signMessage({ message });
      },
    };
  }, []);

  return (
    <DevWalletContext.Provider value={wallet}>
      {children}
    </DevWalletContext.Provider>
  );
}

export function useDevWallet(): DevWallet | null {
  return useContext(DevWalletContext);
}
