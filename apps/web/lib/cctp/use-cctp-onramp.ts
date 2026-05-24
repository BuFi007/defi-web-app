"use client";

/**
 * useCctpOnramp — the one-click Fuji → Arc CCTP V2 deposit hook.
 *
 * Wraps the logic from `scripts/cctp-onramp.ts` (the keeper-side CLI
 * that bootstraps demo wallets) into a React hook that the
 * `CctpOnrampSheet` UI drives. The user's CONNECTED wallet plays the
 * role the script's KEEPER plays: it approves Fuji USDC, calls
 * `depositForBurn` on Fuji, waits for Iris, and calls `receiveMessage`
 * on Arc. No keeper / no relayer — the user is paying gas on both
 * legs (Fuji AVAX + Arc native USDC).
 *
 * Cross-chain wallet handling:
 *   wagmi's `useWalletClient({ chainId })` returns a viem WalletClient
 *   pinned to that chain. We hold two — one for Fuji, one for Arc —
 *   and switch the user's wallet's active chain via `useSwitchChain`
 *   before each write so MetaMask / WalletConnect render the right
 *   chain in their popup. (Without the switch the wallet rejects the
 *   tx as "wrong chain".)
 *
 * Cancellation:
 *   `cancel()` aborts the in-flight attestation poll, resets the FSM,
 *   and lets the UI close cleanly. There are no setTimeouts outside
 *   `pollAttestation` to leak — the burn/mint receipts use viem's
 *   built-in `waitForTransactionReceipt` which is fetch-based.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
  formatUnits,
  pad,
  parseUnits,
} from "viem";
import { avalancheFuji, arcTestnet } from "wagmi/chains";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import {
  ARC_CCTP_DOMAIN,
  ARC_CHAIN_ID,
  ARC_MESSAGE_TRANSMITTER_V2,
  ARC_USDC,
  DEFAULT_MAX_FEE_RAW,
  ERC20_ABI,
  FINALITY_FAST,
  FUJI_CHAIN_ID,
  FUJI_TOKEN_MESSENGER_V2,
  FUJI_USDC,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2_ABI,
} from "./contracts";
import { pollAttestation } from "./iris-attestation";
import {
  burnSubmitted,
  cancel as cancelTransition,
  completeApprove,
  completeAttest,
  completeBurn,
  completeMint,
  failApprove,
  failAttest,
  failBurn,
  failMint,
  initialOnrampState,
  mintSubmitted,
  progressAttest,
  skipApprove,
  startApprove,
  startAttest,
  startBurn,
  startMint,
  type OnrampState,
} from "./onramp-state-machine";
import {
  prettifySimError,
  simulateThenWrite,
  type SimError,
} from "./use-simulated-write-inline";

// ── Reducer shim ───────────────────────────────────────────────────────────
// We could call the transition functions directly with setState, but
// useReducer keeps the state updates colocated with the actions and
// makes the FSM trivial to reason about in React DevTools.
type Action =
  | { type: "RESET" }
  | { type: "PATCH"; patch: (s: OnrampState) => OnrampState };

function reducer(state: OnrampState, action: Action): OnrampState {
  if (action.type === "RESET") return initialOnrampState;
  return action.patch(state);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function addressToBytes32(addr: Address): Hex {
  return pad(addr, { size: 32 });
}

/**
 * Pull the canonical CCTP `MessageSent(bytes message)` log out of the
 * burn receipt. We don't actually CONSUME this on the mint side (Iris
 * returns the canonical bytes in its `message` field), but if the
 * log is missing the burn receipt didn't come from TokenMessengerV2
 * and we should fail loudly.
 */
function extractMessageBytes(receipt: {
  logs: ReadonlyArray<{
    address: Address;
    topics: readonly Hex[];
    data: Hex;
  }>;
}): Hex | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      }) as { eventName: string; args: { message: Hex } };
      if (decoded.eventName === "MessageSent") return decoded.args.message;
    } catch {
      /* not a MessageSent log, keep scanning */
    }
  }
  return null;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface UseCctpOnrampOptions {
  /**
   * Recipient address on Arc — defaults to the connected wallet
   * (the trader bridges TO themselves). Sheet can override when we
   * later support depositing-to-a-trade-account.
   */
  recipient?: Address;
  /**
   * Per-call CCTP V2 maxFee in raw USDC. Defaults to 500 (0.0005 USDC).
   */
  maxFeeRaw?: bigint;
}

export interface UseCctpOnrampReturn {
  state: OnrampState;
  /**
   * Start the four-step flow with `amountUsdcStr` (human-readable,
   * e.g. "10" for 10 USDC). The promise resolves when the FSM
   * terminates (success, error, or cancel).
   */
  start: (amountUsdcStr: string) => Promise<void>;
  /** Abort the in-flight poll + reset the FSM. */
  cancel: () => void;
  /** Reset to the initial state — typically called when re-opening the sheet. */
  reset: () => void;
  /** True while any step is in flight. */
  busy: boolean;
}

export function useCctpOnramp(
  opts: UseCctpOnrampOptions = {},
): UseCctpOnrampReturn {
  const { address: account } = useAccount();
  const fujiPublic = usePublicClient({ chainId: FUJI_CHAIN_ID });
  const arcPublic = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { data: fujiWallet } = useWalletClient({ chainId: FUJI_CHAIN_ID });
  const { data: arcWallet } = useWalletClient({ chainId: ARC_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();

  const [state, dispatch] = useReducer(reducer, initialOnrampState);

  // AbortController lives in a ref so `cancel()` can reach it without
  // creating a new closure every render. We allocate a fresh one per
  // `start()` invocation.
  const abortRef = useRef<AbortController | null>(null);

  // Tear down on unmount — if the sheet closes mid-poll, abort cleanly.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const recipient = useMemo(
    () => opts.recipient ?? (account as Address | undefined),
    [opts.recipient, account],
  );
  const maxFeeRaw = opts.maxFeeRaw ?? DEFAULT_MAX_FEE_RAW;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "PATCH", patch: cancelTransition });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  const start = useCallback(
    async (amountUsdcStr: string): Promise<void> => {
      // Guard against double-start.
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Reset FSM at the top of every run so retry behaves cleanly.
      dispatch({ type: "RESET" });

      // ── Pre-flight: connected wallet + recipient + clients ────────
      if (!account) {
        dispatch({
          type: "PATCH",
          patch: (s) =>
            failApprove(s, {
              error: "Connect a wallet to deposit USDC to Arc.",
            }),
        });
        return;
      }
      if (!recipient) {
        dispatch({
          type: "PATCH",
          patch: (s) =>
            failApprove(s, {
              error: "No Arc recipient address available.",
            }),
        });
        return;
      }
      if (!fujiPublic || !arcPublic || !fujiWallet || !arcWallet) {
        dispatch({
          type: "PATCH",
          patch: (s) =>
            failApprove(s, {
              error:
                "Wallet not ready for Fuji + Arc — try reconnecting your wallet.",
            }),
        });
        return;
      }
      let amountRaw: bigint;
      try {
        amountRaw = parseUnits(amountUsdcStr, 6);
        if (amountRaw <= 0n) throw new Error("Amount must be greater than zero");
      } catch (e) {
        dispatch({
          type: "PATCH",
          patch: (s) =>
            failApprove(s, {
              error: `Invalid amount: ${(e as Error).message}`,
            }),
        });
        return;
      }

      const required = amountRaw + maxFeeRaw;

      // ── Step 1: approve ───────────────────────────────────────────
      let currentAllowance: bigint;
      try {
        currentAllowance = (await fujiPublic.readContract({
          address: FUJI_USDC,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account as Address, FUJI_TOKEN_MESSENGER_V2],
        })) as bigint;
      } catch (e) {
        dispatch({
          type: "PATCH",
          patch: (s) =>
            failApprove(s, {
              error: `Couldn't read Fuji USDC allowance: ${(e as Error).message}`,
            }),
        });
        return;
      }

      if (currentAllowance >= required) {
        dispatch({
          type: "PATCH",
          patch: (s) => skipApprove(s, currentAllowance, required),
        });
      } else {
        dispatch({
          type: "PATCH",
          patch: (s) => startApprove(s, currentAllowance, required),
        });
        try {
          // Make sure the user's wallet is on Fuji for the approve.
          await switchChainAsync({ chainId: FUJI_CHAIN_ID });
          const approveTx = await simulateThenWrite({
            publicClient: fujiPublic as PublicClient,
            walletClient: fujiWallet as WalletClient,
            account: account as Address,
            chain: avalancheFuji,
            call: {
              address: FUJI_USDC,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [FUJI_TOKEN_MESSENGER_V2, required],
            },
          });
          await fujiPublic.waitForTransactionReceipt({ hash: approveTx });
          if (ctrl.signal.aborted) return;
          dispatch({
            type: "PATCH",
            patch: (s) => completeApprove(s, approveTx),
          });
        } catch (e) {
          const sim = prettifySimError(e);
          dispatch({
            type: "PATCH",
            patch: (s) =>
              failApprove(s, {
                error: sim.short,
                simError: sim,
              }),
          });
          return;
        }
      }

      // ── Step 2: burn on Fuji ──────────────────────────────────────
      dispatch({ type: "PATCH", patch: startBurn });
      let burnTxHash: Hex;
      try {
        await switchChainAsync({ chainId: FUJI_CHAIN_ID });
        burnTxHash = await simulateThenWrite({
          publicClient: fujiPublic as PublicClient,
          walletClient: fujiWallet as WalletClient,
          account: account as Address,
          chain: avalancheFuji,
          call: {
            address: FUJI_TOKEN_MESSENGER_V2,
            abi: TOKEN_MESSENGER_V2_ABI,
            functionName: "depositForBurn",
            args: [
              amountRaw,
              ARC_CCTP_DOMAIN,
              addressToBytes32(recipient),
              FUJI_USDC,
              // destinationCaller=0 — anyone can call receiveMessage on Arc.
              ("0x" + "00".repeat(32)) as Hex,
              maxFeeRaw,
              FINALITY_FAST,
            ],
          },
        });
        dispatch({
          type: "PATCH",
          patch: (s) => burnSubmitted(s, burnTxHash),
        });
        const burnReceipt = await fujiPublic.waitForTransactionReceipt({
          hash: burnTxHash,
        });
        const messageBytes = extractMessageBytes(burnReceipt);
        if (!messageBytes) {
          throw new Error(
            "MessageSent log missing from burn receipt — wrong contract or ABI mismatch",
          );
        }
        if (ctrl.signal.aborted) return;
        dispatch({ type: "PATCH", patch: (s) => completeBurn(s, burnTxHash) });
      } catch (e) {
        const sim = prettifySimError(e);
        dispatch({
          type: "PATCH",
          patch: (s) => failBurn(s, { error: sim.short, simError: sim }),
        });
        return;
      }

      // ── Step 3: attest via Iris ───────────────────────────────────
      dispatch({ type: "PATCH", patch: startAttest });
      const att = await pollAttestation({
        burnTxHash,
        signal: ctrl.signal,
        onProgress: (p) =>
          dispatch({
            type: "PATCH",
            patch: (s) =>
              progressAttest(s, {
                irisStatus: p.irisStatus,
                elapsedMs: p.elapsedMs,
                attempts: p.attempts,
              }),
          }),
      });
      if (att.status === "aborted") {
        // Caller already saw the cancel transition.
        return;
      }
      if (att.status !== "complete" || !att.message || !att.attestation) {
        const reason =
          att.status === "timeout"
            ? `Attestation didn't arrive in ${Math.round(att.durationMs / 1000)}s. Burn is on-chain — you can retry the mint manually with the burn tx hash.`
            : (att.reason ?? "Attestation failed");
        dispatch({ type: "PATCH", patch: (s) => failAttest(s, reason) });
        return;
      }
      dispatch({
        type: "PATCH",
        patch: (s) =>
          completeAttest(s, { message: att.message!, attestation: att.attestation! }),
      });

      // ── Step 4: mint on Arc ───────────────────────────────────────
      dispatch({ type: "PATCH", patch: startMint });
      try {
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
        const mintTx = await simulateThenWrite({
          publicClient: arcPublic as PublicClient,
          walletClient: arcWallet as WalletClient,
          account: account as Address,
          chain: arcTestnet,
          call: {
            address: ARC_MESSAGE_TRANSMITTER_V2,
            abi: MESSAGE_TRANSMITTER_V2_ABI,
            functionName: "receiveMessage",
            args: [att.message, att.attestation],
          },
        });
        dispatch({ type: "PATCH", patch: (s) => mintSubmitted(s, mintTx) });
        await arcPublic.waitForTransactionReceipt({ hash: mintTx });
        if (ctrl.signal.aborted) return;
        // Read final balance so we can render the success toast with
        // an honest "X USDC arrived" number instead of just echoing the
        // requested amount.
        const newBalance = (await arcPublic.readContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [recipient],
        })) as bigint;
        // Iris's `maxFee` is the worst-case attestation fee; Circle
        // actually charges less, so the user-visible "arrived" amount
        // is the requested amount minus what Circle siphoned. Reading
        // the post-mint balance is the source of truth; for the toast
        // we show the requested amount because that's the number the
        // trader typed and any discrepancy is sub-cent.
        const short = `${formatUnits(amountRaw, 6)} USDC arrived at ${recipient.slice(0, 6)}…${recipient.slice(-4)}. Ready to trade.`;
        dispatch({
          type: "PATCH",
          patch: (s) => completeMint(s, mintTx, newBalance, short),
        });
      } catch (e) {
        const sim = prettifySimError(e);
        dispatch({
          type: "PATCH",
          patch: (s) => failMint(s, { error: sim.short, simError: sim }),
        });
        return;
      }
    },
    [
      account,
      arcPublic,
      arcWallet,
      fujiPublic,
      fujiWallet,
      maxFeeRaw,
      recipient,
      switchChainAsync,
    ],
  );

  const busy =
    !state.done &&
    (state.approve.phase === "running" ||
      state.burn.phase === "running" ||
      state.attest.phase === "running" ||
      state.mint.phase === "running");

  return { state, start, cancel, reset, busy };
}

// Re-export SimError for the sheet's UI rendering.
export type { SimError };
