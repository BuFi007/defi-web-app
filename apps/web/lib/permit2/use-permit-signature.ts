/**
 * React hook surface around the Permit2 typed-data builders.
 *
 * Wraps wagmi's `useSignTypedData` so call sites don't have to know about
 * the EIP-712 envelope structure — they just hand the hook a `{ token,
 * amount, deadline, nonce, ... }` and get back a signed permit ready to
 * pass to the router.
 *
 * Feature-flagged via `resolvePermit2Router(chainId)`:
 *   - When the router env is set: hook returns a signed envelope.
 *   - When the router env is unset: hook returns `null` and `isAvailable`
 *     reads false, so the UI can render the legacy approve+deposit path.
 *
 * The hook deliberately does NOT submit anything on-chain — that's the
 * router caller's job. This keeps it composable with `useSimulatedWrite`
 * (PR #44) and `useOptimisticPlaceOrder` (PR #49) without coupling.
 */

"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useSignTypedData } from "wagmi";

import { resolvePermit2Router } from "./router";
import {
  buildPermitSingleTypedData,
  buildPermitTransferFromTypedData,
} from "./typed-data";
import type {
  PermitSingleArgs,
  PermitTransferFromArgs,
  SignedPermitSingle,
  SignedPermitTransferFrom,
} from "./types";

export interface UsePermit2SignatureResult {
  /**
   * Sign a long-lived AllowanceTransfer permit.
   *
   * Returns:
   *   - SignedPermitSingle on success
   *   - null when the router env is unset (feature flag off) OR when the
   *     wallet is not connected. Callers should fall back to the legacy
   *     approve+transfer path in this case.
   *
   * Throws on wallet rejection or signing errors — callers should
   * try/catch and distinguish `UserRejectedRequestError` if needed.
   */
  signPermitSingle: (
    args: Omit<PermitSingleArgs, "owner"> & { owner?: PermitSingleArgs["owner"] },
  ) => Promise<SignedPermitSingle | null>;
  /**
   * Sign a single-use SignatureTransfer permit. Same null-semantics as
   * `signPermitSingle`.
   */
  signPermitTransferFrom: (
    args: Omit<PermitTransferFromArgs, "owner"> & { owner?: PermitTransferFromArgs["owner"] },
  ) => Promise<SignedPermitTransferFrom | null>;
  /**
   * `true` when the Permit2 router is configured for `chainId`. Use this
   * to gate UI between the one-sig flow and the fallback approve flow.
   */
  isAvailable: (chainId: number) => boolean;
}

/**
 * Build a `UsePermit2SignatureResult` hooked into wagmi's signer.
 *
 * Design note: the hook captures `signTypedDataAsync` + connected account
 * inside the closure but exposes a stable callback API. Memoised so React
 * Query keys / effect deps don't churn.
 */
export function usePermit2Signature(): UsePermit2SignatureResult {
  const { signTypedDataAsync } = useSignTypedData();
  const account = useAccount();

  const signPermitSingle = useCallback<UsePermit2SignatureResult["signPermitSingle"]>(
    async (args) => {
      const owner = args.owner ?? account.address;
      if (!owner) return null;
      const spender = args.spender ?? resolvePermit2Router(args.chainId);
      if (!spender) return null;

      const typedData = buildPermitSingleTypedData({
        ...args,
        owner,
        spender,
      });

      const signature = await signTypedDataAsync({
        account: owner,
        domain: typedData.domain,
        // The wagmi/viem signTypedData typing expects `types` to include
        // EIP712Domain implicitly — we only pass our message types and let
        // viem derive the domain type from `domain` itself.
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      return {
        permit: typedData.message,
        signature,
        chainId: args.chainId,
        spender,
      };
    },
    [account.address, signTypedDataAsync],
  );

  const signPermitTransferFrom = useCallback<
    UsePermit2SignatureResult["signPermitTransferFrom"]
  >(
    async (args) => {
      const owner = args.owner ?? account.address;
      if (!owner) return null;
      const spender = args.spender ?? resolvePermit2Router(args.chainId);
      if (!spender) return null;

      const typedData = buildPermitTransferFromTypedData({
        ...args,
        owner,
        spender,
      });

      const signature = await signTypedDataAsync({
        account: owner,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      return {
        permit: typedData.message,
        signature,
        chainId: args.chainId,
        spender,
      };
    },
    [account.address, signTypedDataAsync],
  );

  const isAvailable = useCallback(
    (chainId: number) => resolvePermit2Router(chainId) !== null,
    [],
  );

  return useMemo(
    () => ({ signPermitSingle, signPermitTransferFrom, isAvailable }),
    [signPermitSingle, signPermitTransferFrom, isAvailable],
  );
}
