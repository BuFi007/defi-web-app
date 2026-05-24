"use client";

/**
 * Direct on-chain perp writes, wrapped in `useSimulatedWrite` so revert
 * reasons surface BEFORE the wallet popup. Mirrors the lending path
 * landed in PR #44 (apps/web/lib/telarana/hooks.ts → useLendingAction)
 * but for the four perp write surfaces:
 *
 *   1. depositMargin   — FxMarginAccount.depositMargin(trader, amount)
 *   2. withdrawMargin  — FxMarginAccount.withdrawMargin(trader, amount)
 *   3. cancelOrder     — FxOrderSettlement.cancelOrder(uint64 nonce)
 *   4. placeOrder      — API-mediated (EIP-712 signed intent posted to
 *                        /perps/intents). NOT a direct write — wrapped at
 *                        the mutation layer in `use-optimistic-position.ts`
 *                        because there's no `simulateContract` to call.
 *
 * The `depositMargin` path also handles the USDC ERC-20 approve dance
 * (exact-amount approve, not MaxUint256, same posture as the lending
 * supply path).
 *
 * Each hook returns the same shape:
 *   { submit, simulating, submitting, simError, clearError, txHash }
 *
 * Callers render `simError` inline (small "Would revert: …" card) and
 * never see a wallet popup if simulation fails.
 */

import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWalletClient,
} from "wagmi";

import {
  FxMarginAccountAbi,
  FxOrderSettlementAbi,
  Perps,
} from "@bufi/contracts";

import {
  prettifySimError,
  simulateThenWrite,
  type SimError,
} from "@/lib/web3/use-simulated-write";

// Minimal ERC-20 ABI — only the two functions the margin-deposit pre-flight
// needs. Identical shape to the lending-path helper so future consolidation
// is cheap. NOT exported; this is an implementation detail.
const ERC20_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// USDC token addresses per hub chain. Mirrors USDC_BY_CHAIN in
// trade-island/panels.tsx — DRY'd here so the deposit hook doesn't have to
// reach into that component file. Spokes are deliberately excluded; perps
// margin lives on the hubs.
const USDC_BY_CHAIN: Record<number, Address> = {
  43113: "0x5425890298aed601595a70AB815c96711a31Bc65", // Fuji
  5042002: "0x3600000000000000000000000000000000000000", // Arc
};

export interface PerpWriteState {
  simulating: boolean;
  submitting: boolean;
  simError: SimError | null;
  /** Last successful tx hash, if any. Cleared on the next submit. */
  txHash: Hex | null;
  /** Clear the cached `simError` (e.g. when the user edits the input). */
  clearError: () => void;
}

export interface UseDepositMarginResult extends PerpWriteState {
  submit: (input: {
    /** Amount in USDC (6-decimal) base units (bigint). */
    amount: bigint;
    /** Override trader address; defaults to connected account. */
    trader?: Address;
    /** Override chain id; defaults to wagmi-connected chain. */
    chainId?: number;
  }) => Promise<{ txHash?: Hex; approveTx?: Hex; simError?: SimError }>;
}

export interface UseWithdrawMarginResult extends PerpWriteState {
  submit: (input: {
    amount: bigint;
    trader?: Address;
    chainId?: number;
  }) => Promise<{ txHash?: Hex; simError?: SimError }>;
}

export interface UseCancelOrderResult extends PerpWriteState {
  submit: (input: {
    /** Order nonce (uint64-castable). Accepts string|number|bigint. */
    nonce: string | number | bigint;
    chainId?: number;
  }) => Promise<{ txHash?: Hex; simError?: SimError }>;
}

function usePerpWriteState() {
  const [simulating, setSimulating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [simError, setSimError] = useState<SimError | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const clearError = useCallback(() => setSimError(null), []);
  return {
    simulating,
    setSimulating,
    submitting,
    setSubmitting,
    simError,
    setSimError,
    txHash,
    setTxHash,
    clearError,
  };
}

/**
 * Resolve the FxMarginAccount address for a chain, with a typed error if
 * the chain has no perps deployment. The address book lives in
 * `@bufi/contracts/Perps` (Arc testnet is the only hub today).
 */
function marginAccountAddress(chainId: number): Address | undefined {
  return Perps.getPerpsContractAddress(chainId, "FxMarginAccount");
}

function orderSettlementAddress(chainId: number): Address | undefined {
  return Perps.getPerpsContractAddress(chainId, "FxOrderSettlement");
}

function noDeploymentError(name: string, chainId: number): SimError {
  return {
    short: `${name} not deployed on chain ${chainId}`,
    full:
      `Perps stack isn't deployed on this network. Switch to a hub chain ` +
      `(Arc testnet) or pass an explicit chainId override.`,
  };
}

/**
 * depositMargin(trader, amount) — moves USDC from the connected wallet
 * into FxMarginAccount. ERC-20 approve is dispatched first if the current
 * allowance is below `amount`. Both writes go through simulateContract.
 */
export function useDepositMargin(): UseDepositMarginResult {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const state = usePerpWriteState();

  const submit = useCallback<UseDepositMarginResult["submit"]>(
    async ({ amount, trader, chainId }) => {
      const chain = chainId ?? wagmiChainId;
      const account = (trader ?? address) as Address | undefined;
      if (!account) {
        const err: SimError = {
          short: "Wallet not connected",
          full: "Connect a wallet before depositing margin.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      if (!walletClient || !publicClient) {
        const err: SimError = {
          short: "RPC not ready",
          full: "Public/wallet client not initialised yet — retry in a moment.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      const marginAccount = marginAccountAddress(chain);
      if (!marginAccount) {
        const err = noDeploymentError("FxMarginAccount", chain);
        state.setSimError(err);
        return { simError: err };
      }
      const usdc = USDC_BY_CHAIN[chain];
      if (!usdc) {
        const err: SimError = {
          short: `USDC not configured for chain ${chain}`,
          full: "Add the USDC address to USDC_BY_CHAIN to deposit margin here.",
        };
        state.setSimError(err);
        return { simError: err };
      }

      state.setSimError(null);
      state.setSimulating(true);
      try {
        // Step 1 — ensure ERC-20 allowance. Exact-amount approve so a
        // leftover allowance can't be drained later. Same posture as the
        // lending path.
        let approveTx: Hex | undefined;
        const current = (await publicClient.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account, marginAccount],
        })) as bigint;
        if (current < amount) {
          // Simulate the approve first so an ERC-20-level revert (paused
          // token, blocked address, etc.) surfaces before the popup.
          state.setSubmitting(true);
          approveTx = await simulateThenWrite({
            publicClient,
            walletClient,
            account,
            call: {
              address: usdc,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [marginAccount, amount],
            },
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
          state.setSubmitting(false);
        }

        // Step 2 — simulate + write the deposit. ERC20InsufficientBalance
        // / InsufficientAllowance / contract-paused reverts all bubble up
        // here as a decoded reason instead of a burned wallet popup.
        state.setSimulating(true);
        const txHash = await simulateThenWrite({
          publicClient,
          walletClient,
          account,
          call: {
            address: marginAccount,
            abi: FxMarginAccountAbi,
            functionName: "depositMargin",
            args: [account, amount],
          },
        });
        state.setTxHash(txHash);
        return { txHash, approveTx };
      } catch (err) {
        const pretty = prettifySimError(err);
        state.setSimError(pretty);
        return { simError: pretty };
      } finally {
        state.setSimulating(false);
        state.setSubmitting(false);
      }
    },
    [address, wagmiChainId, publicClient, walletClient, state],
  );

  return {
    submit,
    simulating: state.simulating,
    submitting: state.submitting,
    simError: state.simError,
    txHash: state.txHash,
    clearError: state.clearError,
  };
}

/**
 * withdrawMargin(trader, amount) — pulls USDC back out of the margin
 * account. Contract requires `msg.sender == trader` OR an account-operator
 * role; we always pass the connected account as `trader` so non-operator
 * users can withdraw their own collateral. Simulate catches
 * `InsufficientFreeMargin` and role-mismatch reverts inline.
 */
export function useWithdrawMargin(): UseWithdrawMarginResult {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const state = usePerpWriteState();

  const submit = useCallback<UseWithdrawMarginResult["submit"]>(
    async ({ amount, trader, chainId }) => {
      const chain = chainId ?? wagmiChainId;
      const account = (trader ?? address) as Address | undefined;
      if (!account) {
        const err: SimError = {
          short: "Wallet not connected",
          full: "Connect a wallet before withdrawing margin.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      if (!walletClient || !publicClient) {
        const err: SimError = {
          short: "RPC not ready",
          full: "Public/wallet client not initialised yet — retry in a moment.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      const marginAccount = marginAccountAddress(chain);
      if (!marginAccount) {
        const err = noDeploymentError("FxMarginAccount", chain);
        state.setSimError(err);
        return { simError: err };
      }

      state.setSimError(null);
      state.setSimulating(true);
      try {
        const txHash = await simulateThenWrite({
          publicClient,
          walletClient,
          account,
          call: {
            address: marginAccount,
            abi: FxMarginAccountAbi,
            functionName: "withdrawMargin",
            args: [account, amount],
          },
        });
        state.setTxHash(txHash);
        return { txHash };
      } catch (err) {
        const pretty = prettifySimError(err);
        state.setSimError(pretty);
        return { simError: pretty };
      } finally {
        state.setSimulating(false);
        state.setSubmitting(false);
      }
    },
    [address, wagmiChainId, publicClient, walletClient, state],
  );

  return {
    submit,
    simulating: state.simulating,
    submitting: state.submitting,
    simError: state.simError,
    txHash: state.txHash,
    clearError: state.clearError,
  };
}

/**
 * cancelOrder(nonce) — direct user write on FxOrderSettlement. Common
 * reverts the simulate-first wrap catches: `NonceAlreadyUsed`,
 * `NotOrderOwner`, `OrderExpired`, contract-paused.
 */
export function useCancelOrder(): UseCancelOrderResult {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const state = usePerpWriteState();

  const submit = useCallback<UseCancelOrderResult["submit"]>(
    async ({ nonce, chainId }) => {
      const chain = chainId ?? wagmiChainId;
      const account = address as Address | undefined;
      if (!account) {
        const err: SimError = {
          short: "Wallet not connected",
          full: "Connect a wallet before cancelling an order.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      if (!walletClient || !publicClient) {
        const err: SimError = {
          short: "RPC not ready",
          full: "Public/wallet client not initialised yet — retry in a moment.",
        };
        state.setSimError(err);
        return { simError: err };
      }
      const settlement = orderSettlementAddress(chain);
      if (!settlement) {
        const err = noDeploymentError("FxOrderSettlement", chain);
        state.setSimError(err);
        return { simError: err };
      }
      // Normalize nonce to bigint then narrow to uint64 range. We let viem
      // validate the actual uint64 bound at simulate-time; this just
      // produces a bigint regardless of input shape.
      let nonceBig: bigint;
      try {
        nonceBig =
          typeof nonce === "bigint" ? nonce : BigInt(nonce);
      } catch {
        const err: SimError = {
          short: "Invalid nonce",
          full: `Order nonce "${String(nonce)}" is not a valid integer.`,
        };
        state.setSimError(err);
        return { simError: err };
      }

      state.setSimError(null);
      state.setSimulating(true);
      try {
        const txHash = await simulateThenWrite({
          publicClient,
          walletClient,
          account,
          call: {
            address: settlement,
            abi: FxOrderSettlementAbi,
            functionName: "cancelOrder",
            args: [nonceBig],
          },
        });
        state.setTxHash(txHash);
        return { txHash };
      } catch (err) {
        const pretty = prettifySimError(err);
        state.setSimError(pretty);
        return { simError: pretty };
      } finally {
        state.setSimulating(false);
        state.setSubmitting(false);
      }
    },
    [address, wagmiChainId, publicClient, walletClient, state],
  );

  return {
    submit,
    simulating: state.simulating,
    submitting: state.submitting,
    simError: state.simError,
    txHash: state.txHash,
    clearError: state.clearError,
  };
}
