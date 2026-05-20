/**
 * Retry / backoff policy for webhook delivery.
 *
 * Backoff schedule (from Wave H2 spec):
 *   attempt 1 -> wait 1m
 *   attempt 2 -> wait 5m
 *   attempt 3 -> wait 30m
 *   attempt 4 -> wait 6h
 *   attempt 5 -> wait 24h
 *
 * After attempt 5 fails, the subscription is dead-lettered and flagged
 * `disabled` until the integrator re-enables (out of scope here; we just log
 * + flip the status). A 2xx at any attempt resets the failure counter.
 */

import { DEFAULT_RETRY_DELAYS_MS, MAX_DELIVERY_ATTEMPTS } from "./types";

export interface NextAttemptInput {
  /** Attempt that just failed (1-based). */
  attempt: number;
  /** Reference time, defaults to Date.now(). */
  nowMs?: number;
  /** Override the delay table. Tests pass a shorter one. */
  delays?: ReadonlyArray<number>;
}

export interface NextAttemptDecision {
  /** Either schedule a retry at this unix-ms timestamp, or dead-letter. */
  kind: "retry" | "dead_letter";
  /** Next attempt number (1-based). Only meaningful when `kind === "retry"`. */
  nextAttempt: number;
  /** Unix ms when the next delivery should fire. */
  scheduledFor: number;
}

/**
 * Decide what to do after attempt `attempt` failed. Returns either:
 *  - `{ kind: "retry", nextAttempt, scheduledFor }` if there are more attempts left, OR
 *  - `{ kind: "dead_letter", … }` if attempt was the last one (caller flips status).
 */
export function decideNextAttempt(input: NextAttemptInput): NextAttemptDecision {
  const now = input.nowMs ?? Date.now();
  const delays = input.delays ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAttempts = delays.length;

  if (input.attempt >= maxAttempts) {
    return {
      kind: "dead_letter",
      nextAttempt: input.attempt,
      scheduledFor: now,
    };
  }
  const nextAttempt = input.attempt + 1;
  // delays[i] is the wait BEFORE attempt (i+1). After attempt N fails we
  // wait delays[N] (0-indexed) before firing attempt N+1.
  const wait = delays[input.attempt] ?? delays[delays.length - 1] ?? 0;
  return {
    kind: "retry",
    nextAttempt,
    scheduledFor: now + wait,
  };
}

/**
 * Initial scheduling for a brand-new delivery — fire immediately on
 * attempt 1.
 */
export function initialAttempt(nowMs: number = Date.now()): NextAttemptDecision {
  return { kind: "retry", nextAttempt: 1, scheduledFor: nowMs };
}

export { DEFAULT_RETRY_DELAYS_MS, MAX_DELIVERY_ATTEMPTS };
