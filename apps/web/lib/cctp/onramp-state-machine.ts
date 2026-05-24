/**
 * CCTP onramp state machine — 4-step Fuji→Arc deposit FSM.
 *
 * Plain TypeScript discriminated-union FSM — no XState dependency.
 * The hook (`use-cctp-onramp.ts`) holds a single `OnrampState` and
 * applies `transition()` reducers as each step completes. The UI
 * (step indicator + sheet) reads `state.step` and `state.[stepKey]`
 * to render per-step loading / success / error visuals.
 *
 * Step semantics:
 *   1. APPROVE — read keeper's allowance on FUJI_USDC for
 *      FUJI_TOKEN_MESSENGER_V2. If insufficient, call ERC-20 approve.
 *      If allowance already covers `amount + maxFee`, skip in one tick.
 *   2. BURN — depositForBurn on Fuji. Surface tx hash + Snowtrace link.
 *   3. ATTEST — poll Iris with a 120s budget. Surface countdown +
 *      iris status (`pending_confirmations` → `complete`).
 *   4. MINT — receiveMessage on Arc. Surface tx hash + Arcscan link.
 *
 * Each step carries a `phase`: idle → running → success | error.
 * The top-level `state.step` advances only when the current step's
 * phase becomes "success" (or, for approve, "skipped"). Any error
 * holds the FSM on the failing step so the UI can render an inline
 * retry button without losing context.
 */

import type { Hex } from "viem";

import type { SimError } from "./use-simulated-write-inline";

export type StepKey = "approve" | "burn" | "attest" | "mint";

export type Phase = "idle" | "running" | "success" | "skipped" | "error";

/** Step 1 — approve TokenMessengerV2 on Fuji. */
export interface ApproveStep {
  phase: Phase;
  /** Allowance read from Fuji USDC at poll time. */
  currentAllowance?: bigint;
  /** Required allowance (amount + maxFee). */
  requiredAllowance?: bigint;
  /** Approval tx hash (undefined when skipped). */
  txHash?: Hex;
  simError?: SimError;
  error?: string;
}

/** Step 2 — depositForBurn on Fuji. */
export interface BurnStep {
  phase: Phase;
  txHash?: Hex;
  simError?: SimError;
  error?: string;
}

/** Step 3 — poll Iris for an attestation. */
export interface AttestStep {
  phase: Phase;
  /** Iris status from the last poll: "pending_confirmations", "complete", etc. */
  irisStatus?: string;
  /** ms since polling started. UI uses this for a countdown. */
  elapsedMs?: number;
  attempts?: number;
  message?: Hex;
  attestation?: Hex;
  error?: string;
}

/** Step 4 — receiveMessage on Arc. */
export interface MintStep {
  phase: Phase;
  txHash?: Hex;
  simError?: SimError;
  /** Recipient's ERC-20 USDC balance on Arc after the mint. */
  newBalance?: bigint;
  error?: string;
}

export interface OnrampState {
  /** Top-level step pointer — the indicator's active step. */
  step: StepKey;
  /** Final outcome — undefined while the FSM is in flight. */
  done?: "ok" | "error" | "cancelled";
  /** Human-readable summary for the success toast. */
  successMessage?: string;
  approve: ApproveStep;
  burn: BurnStep;
  attest: AttestStep;
  mint: MintStep;
}

export const initialOnrampState: OnrampState = {
  step: "approve",
  approve: { phase: "idle" },
  burn: { phase: "idle" },
  attest: { phase: "idle" },
  mint: { phase: "idle" },
};

// ── Reducer-style transitions (pure functions, easy to test) ──────────────

export function startApprove(s: OnrampState, allowance: bigint, required: bigint): OnrampState {
  return {
    ...s,
    step: "approve",
    approve: {
      ...s.approve,
      phase: "running",
      currentAllowance: allowance,
      requiredAllowance: required,
    },
  };
}

export function skipApprove(s: OnrampState, allowance: bigint, required: bigint): OnrampState {
  return {
    ...s,
    step: "burn",
    approve: {
      phase: "skipped",
      currentAllowance: allowance,
      requiredAllowance: required,
    },
  };
}

export function completeApprove(s: OnrampState, txHash: Hex): OnrampState {
  return {
    ...s,
    step: "burn",
    approve: { ...s.approve, phase: "success", txHash },
  };
}

export function failApprove(
  s: OnrampState,
  err: { error?: string; simError?: SimError },
): OnrampState {
  return {
    ...s,
    done: "error",
    approve: { ...s.approve, phase: "error", ...err },
  };
}

export function startBurn(s: OnrampState): OnrampState {
  return {
    ...s,
    step: "burn",
    burn: { ...s.burn, phase: "running" },
  };
}

export function burnSubmitted(s: OnrampState, txHash: Hex): OnrampState {
  return {
    ...s,
    step: "burn",
    burn: { ...s.burn, txHash, phase: "running" },
  };
}

export function completeBurn(s: OnrampState, txHash: Hex): OnrampState {
  return {
    ...s,
    step: "attest",
    burn: { phase: "success", txHash },
  };
}

export function failBurn(
  s: OnrampState,
  err: { error?: string; simError?: SimError },
): OnrampState {
  return {
    ...s,
    done: "error",
    burn: { ...s.burn, phase: "error", ...err },
  };
}

export function startAttest(s: OnrampState): OnrampState {
  return {
    ...s,
    step: "attest",
    attest: { phase: "running", elapsedMs: 0, attempts: 0 },
  };
}

export function progressAttest(
  s: OnrampState,
  patch: { irisStatus?: string; elapsedMs: number; attempts: number },
): OnrampState {
  return {
    ...s,
    attest: { ...s.attest, ...patch, phase: "running" },
  };
}

export function completeAttest(
  s: OnrampState,
  msg: { message: Hex; attestation: Hex },
): OnrampState {
  return {
    ...s,
    step: "mint",
    attest: { ...s.attest, phase: "success", ...msg },
  };
}

export function failAttest(s: OnrampState, error: string): OnrampState {
  return {
    ...s,
    done: "error",
    attest: { ...s.attest, phase: "error", error },
  };
}

export function startMint(s: OnrampState): OnrampState {
  return {
    ...s,
    step: "mint",
    mint: { ...s.mint, phase: "running" },
  };
}

export function mintSubmitted(s: OnrampState, txHash: Hex): OnrampState {
  return {
    ...s,
    step: "mint",
    mint: { ...s.mint, txHash, phase: "running" },
  };
}

export function completeMint(
  s: OnrampState,
  txHash: Hex,
  newBalance: bigint,
  successMessage: string,
): OnrampState {
  return {
    ...s,
    step: "mint",
    done: "ok",
    successMessage,
    mint: { phase: "success", txHash, newBalance },
  };
}

export function failMint(
  s: OnrampState,
  err: { error?: string; simError?: SimError },
): OnrampState {
  return {
    ...s,
    done: "error",
    mint: { ...s.mint, phase: "error", ...err },
  };
}

export function cancel(s: OnrampState): OnrampState {
  return { ...s, done: "cancelled" };
}

export function reset(): OnrampState {
  return initialOnrampState;
}

/** Cheap derived helpers for the UI. */
export function isInFlight(s: OnrampState): boolean {
  if (s.done) return false;
  return (
    s.approve.phase === "running" ||
    s.burn.phase === "running" ||
    s.attest.phase === "running" ||
    s.mint.phase === "running"
  );
}

/** Ordered step list — drives the step indicator left-to-right. */
export const STEP_ORDER: ReadonlyArray<StepKey> = [
  "approve",
  "burn",
  "attest",
  "mint",
] as const;

export const STEP_LABELS: Record<StepKey, string> = {
  approve: "Approve",
  burn: "Burn on Fuji",
  attest: "Attestation",
  mint: "Mint on Arc",
};
