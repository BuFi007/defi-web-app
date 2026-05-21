/**
 * React hook for the ZeroDev session-key lifecycle.
 *
 * Three states:
 *   - `idle`            no session key persisted for (address, chainId).
 *   - `active`          a session key is loaded into memory + valid.
 *   - `expired`         a session key blob exists but its timestamp policy
 *                       has lapsed; the UI shows a "re-authorise" path.
 *
 * Two actions:
 *   - `enable()`        mints a fresh session key + asks the wagmi wallet
 *                       to sign the ZeroDev owner-approval. ONE popup.
 *   - `revoke()`        drops the encrypted blob + any in-memory key.
 *
 * The feature flag `NEXT_PUBLIC_SESSION_KEYS_ENABLED` short-circuits the
 * whole hook to a neutral idle state; UI surfaces (e.g. the toggle in
 * trade-island) read `isFeatureEnabled` to decide whether to render at
 * all.
 *
 * Bundler/paymaster wiring is intentionally NOT included in this
 * worktree — see `session-keys-README.md` "Open items" for the
 * Pimlico + EIP-7702 trade-off. The hook returns the deserialised
 * KernelAccount, so once a bundler URL is configured callers can
 * `createKernelAccountClient({ account: result.kernelAccount, ... })`
 * and submit UserOps without re-touching this file.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Address,
  type Hex,
  createPublicClient,
  http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { useAccount, useChainId, useWalletClient } from "wagmi";

import {
  createKernelAccount,
  type KernelSmartAccountImplementation,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  serializePermissionAccount,
  deserializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

import {
  buildPerpSessionKeyPolicies,
  DEFAULT_SESSION_KEY_TTL_SECONDS,
} from "./session-key-policies";
import {
  decryptSessionKey,
  isSessionKeyExpired,
  persistSessionKey,
  readSessionKeyRecord,
  revokeSessionKey,
  type StoredSessionKeyRecord,
} from "./session-key-storage";

const ARC_TESTNET_CHAIN_ID = 5042002;
const ENTRY_POINT = getEntryPoint("0.7");
const KERNEL_VERSION = KERNEL_V3_1;

export type SessionKeyStatus = "idle" | "active" | "expired" | "loading";

export interface UseSessionKeyState {
  status: SessionKeyStatus;
  /** True iff NEXT_PUBLIC_SESSION_KEYS_ENABLED resolves to a truthy value. */
  isFeatureEnabled: boolean;
  /** Kernel address the trader signs orders for (i.e. `order.trader`). */
  kernelAddress: Address | null;
  /** Unix seconds the active policy expires. Null if no key is loaded. */
  validUntil: number | null;
  /** Most recent storage record, decryption-free. Null when nothing persisted. */
  record: StoredSessionKeyRecord | null;
  /** Loaded kernel account — null until `loadActive()` resolves. */
  kernelAccount: Awaited<ReturnType<typeof createKernelAccount>> | null;
  /** Last error from enable/revoke/load — surfaced for UI toast. */
  error: Error | null;
}

export interface UseSessionKeyApi extends UseSessionKeyState {
  /** Trigger the ONE-time owner-approval popup + persist the session key. */
  enable: (options?: { ttlSeconds?: number }) => Promise<StoredSessionKeyRecord>;
  /** Drop the persisted blob + in-memory kernel. */
  revoke: () => void;
  /** Force-refresh the storage record + try to hydrate the kernel. */
  refresh: () => Promise<void>;
}

function isFeatureFlagEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SESSION_KEYS_ENABLED;
  if (!raw) return false;
  return raw === "true" || raw === "1" || raw === "yes";
}

function rpcUrlFor(chainId: number): string {
  if (chainId === ARC_TESTNET_CHAIN_ID) {
    return "https://rpc.testnet.arc.network";
  }
  // Caller is responsible for falling back; the kernel ops only run on
  // chains where perps are deployed (today: Arc Testnet only).
  throw new Error(`use-session-key: no RPC url known for chainId=${chainId}`);
}

function publicClientFor(chainId: number) {
  if (chainId === ARC_TESTNET_CHAIN_ID) {
    return createPublicClient({ chain: arcTestnet, transport: http(rpcUrlFor(chainId)) });
  }
  throw new Error(`use-session-key: no chain config for chainId=${chainId}`);
}

export function useSessionKey(): UseSessionKeyApi {
  const isFeatureEnabled = isFeatureFlagEnabled();
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient({ chainId });

  const [record, setRecord] = useState<StoredSessionKeyRecord | null>(null);
  const [kernelAccount, setKernelAccount] = useState<Awaited<
    ReturnType<typeof createKernelAccount>
  > | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  // Hydrate the stored blob whenever (address, chainId) changes.
  useEffect(() => {
    if (!isFeatureEnabled || !address) {
      setRecord(null);
      setKernelAccount(null);
      return;
    }
    const next = readSessionKeyRecord(address, chainId);
    setRecord(next);
    setKernelAccount(null); // force re-hydration after any address swap
  }, [address, chainId, isFeatureEnabled]);

  // Lazy decrypt + deserialize on demand. Kernel hydration is a network
  // round-trip (the public client reads the deployed kernel address)
  // so we don't run it eagerly on every render.
  const hydrate = useCallback(async () => {
    if (!isFeatureEnabled || !address) return;
    const stored = readSessionKeyRecord(address, chainId);
    setRecord(stored);
    if (!stored) {
      setKernelAccount(null);
      return;
    }
    if (isSessionKeyExpired(stored)) {
      setKernelAccount(null);
      return;
    }
    try {
      setLoading(true);
      const { sessionKeyPrivateKey } = await decryptSessionKey(stored);
      const sessionKeyAccount = privateKeyToAccount(sessionKeyPrivateKey);
      const sessionKeySigner = await toECDSASigner({ signer: sessionKeyAccount });
      const publicClient = publicClientFor(stored.chainId);
      const kernel = await deserializePermissionAccount(
        publicClient,
        ENTRY_POINT,
        KERNEL_VERSION,
        stored.approval,
        sessionKeySigner,
      );
      setKernelAccount(kernel);
      setError(null);
    } catch (err) {
      setKernelAccount(null);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [address, chainId, isFeatureEnabled]);

  // Auto-hydrate when a usable record appears (active + matching wallet).
  useEffect(() => {
    if (!record || !address) return;
    if (record.ownerAddress.toLowerCase() !== address.toLowerCase()) return;
    if (isSessionKeyExpired(record)) return;
    if (kernelAccount) return;
    void hydrate();
  }, [record, address, kernelAccount, hydrate]);

  const enable = useCallback(
    async (options?: { ttlSeconds?: number }) => {
      if (!isFeatureEnabled) {
        throw new Error("session keys are disabled (NEXT_PUBLIC_SESSION_KEYS_ENABLED is off)");
      }
      if (!address || !walletClient) {
        throw new Error("connect a wallet before enabling fast trading");
      }
      setLoading(true);
      setError(null);
      try {
        const ttl = options?.ttlSeconds ?? DEFAULT_SESSION_KEY_TTL_SECONDS;
        const now = Math.floor(Date.now() / 1000);
        const validAfter = now;
        const validUntil = now + ttl;

        const policies = buildPerpSessionKeyPolicies({
          chainId,
          validAfter,
          validUntil,
        });

        // Owner side: ECDSA validator backed by the user's wagmi wallet.
        // wagmi's WalletClient ships `account?: Account`; ZeroDev's
        // `Signer` type requires `account: Account`, so we narrow with
        // the `address` check above and pass the WalletClient straight
        // through (it satisfies the Signer shape at runtime — the
        // mismatch is purely on the optional-vs-required typing).
        if (!walletClient.account) {
          throw new Error("wallet client has no account; reconnect the wallet");
        }
        const publicClient = publicClientFor(chainId);
        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
          signer: walletClient as unknown as Parameters<typeof signerToEcdsaValidator>[1]["signer"],
          entryPoint: ENTRY_POINT,
          kernelVersion: KERNEL_VERSION,
        });

        // Session key: fresh private key, lives only in memory + encrypted
        // storage. Never sent to the wagmi wallet, never logged.
        const sessionKeyPrivateKey: Hex = generatePrivateKey();
        const sessionKeyAccount = privateKeyToAccount(sessionKeyPrivateKey);
        const sessionKeySigner = await toECDSASigner({ signer: sessionKeyAccount });

        const permissionValidator = await toPermissionValidator(publicClient, {
          entryPoint: ENTRY_POINT,
          kernelVersion: KERNEL_VERSION,
          signer: sessionKeySigner,
          policies: [policies.callPolicy, policies.timestampPolicy],
        });

        const sessionKernelAccount = await createKernelAccount(publicClient, {
          entryPoint: ENTRY_POINT,
          kernelVersion: KERNEL_VERSION,
          plugins: {
            sudo: ecdsaValidator,
            regular: permissionValidator,
          },
        });

        // ZeroDev's owner-side serialise: triggers the ONE typed-data
        // signature popup the user sees. After this resolves the session
        // key is fully authorised on-chain (lazy-deployed on first UserOp).
        const approval = await serializePermissionAccount(sessionKernelAccount);
        const kernelAddress = sessionKernelAccount.address as Address;

        const persisted = await persistSessionKey({
          ownerAddress: address as Address,
          kernelAddress,
          chainId,
          validAfter,
          validUntil,
          approval,
          sessionKeyPrivateKey,
        });

        setRecord(persisted);
        setKernelAccount(sessionKernelAccount as unknown as Awaited<
          ReturnType<typeof createKernelAccount>
        >);
        return persisted;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [address, chainId, isFeatureEnabled, walletClient],
  );

  const revoke = useCallback(() => {
    if (!address) return;
    revokeSessionKey(address, chainId);
    setRecord(null);
    setKernelAccount(null);
    setError(null);
  }, [address, chainId]);

  const status: SessionKeyStatus = useMemo(() => {
    if (!isFeatureEnabled) return "idle";
    if (loading) return "loading";
    if (!record) return "idle";
    if (isSessionKeyExpired(record)) return "expired";
    return "active";
  }, [isFeatureEnabled, loading, record]);

  return {
    status,
    isFeatureEnabled,
    kernelAddress: record?.kernelAddress ?? null,
    validUntil: record?.validUntil ?? null,
    record,
    kernelAccount,
    error,
    enable,
    revoke,
    refresh: hydrate,
  };
}

// Re-export the type from @zerodev/sdk for callers that need to type the
// kernel for paymaster + bundler wiring downstream.
export type { KernelSmartAccountImplementation };
