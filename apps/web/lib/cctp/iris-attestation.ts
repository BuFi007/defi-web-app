/**
 * Iris (Circle attestation API) polling client.
 *
 * Wraps the V2 messages endpoint:
 *   GET {IRIS_SANDBOX_BASE}/v2/messages/{srcDomain}?transactionHash={burnTxHash}
 *
 * On success the response carries:
 *   {
 *     messages: [{
 *       message: "0x…",        // canonical messageBytes for receiveMessage()
 *       attestation: "0x…",    // signed attestation
 *       status: "complete",    // or "pending_confirmations" while we wait
 *       eventNonce?: "…"
 *     }]
 *   }
 *
 * Cancellation: the polling loop is fully `AbortSignal`-aware. If the
 * user closes the sheet mid-poll, the caller aborts the signal and the
 * loop exits cleanly — no leaked timers, no stale fetch handles, no
 * post-unmount state updates.
 *
 * Rate-limiting: if Iris returns 429 we back off from the default 5s
 * cadence to 10s for the remainder of the poll. (The skill brief calls
 * this out explicitly as a stop condition.)
 */

import {
  BACKOFF_POLL_MS,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  FUJI_CCTP_DOMAIN,
  IRIS_SANDBOX_BASE,
} from "./contracts";

import type { Hex } from "viem";

export interface IrisMessage {
  /** Canonical CCTP message bytes — passed to receiveMessage(). */
  message: Hex;
  /** Signed attestation bytes — passed to receiveMessage(). */
  attestation: Hex;
  /** Iris status: "pending_confirmations" → "complete". */
  status: string;
  /** Optional bookkeeping nonce — not consumed by the mint. */
  eventNonce?: string;
}

export interface IrisResponse {
  messages?: IrisMessage[];
  // Iris also returns `{ error: "…" }` shapes; the caller catches non-2xx.
}

/** Terminal states + a partial-progress state for UI countdowns. */
export type AttestationStatus = "complete" | "timeout" | "error" | "aborted";

export interface AttestationProgress {
  /** ms since the burn tx confirmed. UI uses this for a countdown. */
  elapsedMs: number;
  /** Current iris status string, e.g. "pending_confirmations". */
  irisStatus?: string;
  /** Number of poll attempts. */
  attempts: number;
}

export interface AttestationResult {
  status: AttestationStatus;
  /** Set on `complete`. */
  message?: Hex;
  /** Set on `complete`. */
  attestation?: Hex;
  /** Human-readable reason on non-complete terminations. */
  reason?: string;
  durationMs: number;
  attempts: number;
}

export interface PollAttestationOptions {
  /** Burn tx hash on the source chain (Fuji). */
  burnTxHash: Hex;
  /** Source CCTP domain — defaults to Fuji. */
  srcDomain?: number;
  /** Poll cadence in ms — defaults to 5_000. */
  pollMs?: number;
  /** Hard timeout in ms — defaults to 120_000. */
  timeoutMs?: number;
  /** Abort handle — set when the user closes the sheet. */
  signal?: AbortSignal;
  /** Optional progress callback fired on every poll attempt. */
  onProgress?: (p: AttestationProgress) => void;
}

/**
 * Sleep with abort support. Resolves early when the signal aborts so
 * the polling loop can break out without waiting the full cadence.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollAttestation(
  opts: PollAttestationOptions,
): Promise<AttestationResult> {
  const {
    burnTxHash,
    srcDomain = FUJI_CCTP_DOMAIN,
    pollMs: initialPoll = DEFAULT_POLL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    onProgress,
  } = opts;

  const url = `${IRIS_SANDBOX_BASE}/v2/messages/${srcDomain}?transactionHash=${burnTxHash}`;
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;
  let attempts = 0;
  let lastReason = "no message returned by iris";
  let currentPollMs = initialPoll;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return {
        status: "aborted",
        reason: "poll aborted by caller (sheet closed?)",
        durationMs: Date.now() - startMs,
        attempts,
      };
    }
    attempts += 1;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal,
      });
      if (res.status === 429) {
        // Back off to 10s for the rest of the poll. We don't restart
        // the deadline — the user shouldn't be punished by Iris's
        // rate limit, but neither should we wait indefinitely.
        currentPollMs = BACKOFF_POLL_MS;
        lastReason = `iris HTTP 429 — backing off to ${BACKOFF_POLL_MS}ms`;
        onProgress?.({
          elapsedMs: Date.now() - startMs,
          irisStatus: "rate_limited",
          attempts,
        });
      } else if (!res.ok) {
        lastReason = `iris HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`;
        onProgress?.({
          elapsedMs: Date.now() - startMs,
          irisStatus: `http_${res.status}`,
          attempts,
        });
      } else {
        const body = (await res.json()) as IrisResponse;
        const m = body.messages?.[0];
        if (
          m &&
          m.status === "complete" &&
          m.message &&
          m.message !== "0x" &&
          m.attestation &&
          m.attestation !== "0x"
        ) {
          return {
            status: "complete",
            message: m.message,
            attestation: m.attestation,
            durationMs: Date.now() - startMs,
            attempts,
          };
        }
        if (m) {
          lastReason = `iris status=${m.status} (attempt ${attempts})`;
          onProgress?.({
            elapsedMs: Date.now() - startMs,
            irisStatus: m.status,
            attempts,
          });
        } else {
          lastReason = `iris empty messages[] (attempt ${attempts})`;
          onProgress?.({
            elapsedMs: Date.now() - startMs,
            irisStatus: "empty",
            attempts,
          });
        }
      }
    } catch (e) {
      // Aborted fetch surfaces as an AbortError — propagate as "aborted".
      const msg = (e as Error).message ?? String(e);
      if (signal?.aborted || /aborted|abortcontroller/i.test(msg)) {
        return {
          status: "aborted",
          reason: "poll aborted by caller (sheet closed?)",
          durationMs: Date.now() - startMs,
          attempts,
        };
      }
      lastReason = `iris fetch error: ${msg}`;
      onProgress?.({
        elapsedMs: Date.now() - startMs,
        irisStatus: "fetch_error",
        attempts,
      });
    }
    await abortableSleep(currentPollMs, signal);
  }
  return {
    status: signal?.aborted ? "aborted" : "timeout",
    reason: signal?.aborted ? "poll aborted by caller" : lastReason,
    durationMs: Date.now() - startMs,
    attempts,
  };
}
