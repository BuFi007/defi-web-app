/**
 * React hook surface for client-side withdrawal-proof generation.
 *
 * Talks to the comlink-wrapped Web Worker spawned by `worker-bridge.ts`.
 * Exposes three things to the UI:
 *   - `generateWithdrawProof(input)` — kicks off the proof; returns the
 *     `ProofGenResult` envelope (so the caller can branch on
 *     `unavailable` vs `error` without throwing).
 *   - `progress` — `{ phase, fraction }` updated as the worker emits
 *     progress events. Drives the on-screen progress bar.
 *   - `abort()` — terminates the in-flight proof (and resets the
 *     worker — the next call spawns a fresh one).
 *
 * Pyth-Hermes-style reconnect notes (see README): the worker is NOT
 * long-lived in the way Hermes is. It's spawned on first use, kept
 * around between proofs, and torn down on abort. We do NOT need
 * exponential backoff because there's no network leg — the worker
 * either runs locally or it doesn't.
 *
 * Backend probing happens lazily on first call to `probe()`. We expose
 * `backend` on the hook so the UI can render "Ghost Mode unavailable"
 * before the user even clicks.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProofGenInput,
  ProofGenProgress,
  ProofGenResult,
  ProverBackend,
} from "./types";
import {
  abortInFlight,
  probeWorker,
  proveWithdrawViaWorker,
} from "./worker-bridge";

const INITIAL_PROGRESS: ProofGenProgress = { phase: "idle", fraction: 0 };

export interface UseProofGenReturn {
  /** Backend the worker is using; "unavailable" means no circuit. */
  backend: ProverBackend;
  /** Circuit commit hash (from the artifact's `version` field). */
  circuitVersion?: string;
  /** True after the initial probe completes. */
  ready: boolean;
  /** Live progress — `phase: "idle"` until a proof is in flight. */
  progress: ProofGenProgress;
  /** True if `generateWithdrawProof` is currently running. */
  isProving: boolean;
  /** Last result (success OR failure) from `generateWithdrawProof`. */
  lastResult: ProofGenResult | null;
  /** Kick off proof generation. Returns the envelope (never throws). */
  generateWithdrawProof: (input: ProofGenInput) => Promise<ProofGenResult>;
  /** Abort the in-flight proof. Safe to call when idle. */
  abort: () => Promise<void>;
}

/**
 * Generic worker-driven proof hook. Components should usually consume
 * `useProofGen()` below, which is the documented call-site surface.
 */
function useNoirWorker(): UseProofGenReturn {
  const [backend, setBackend] = useState<ProverBackend>("unavailable");
  const [circuitVersion, setCircuitVersion] = useState<string | undefined>(
    undefined,
  );
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<ProofGenProgress>(INITIAL_PROGRESS);
  const [isProving, setIsProving] = useState(false);
  const [lastResult, setLastResult] = useState<ProofGenResult | null>(null);

  // Track whether the component is still mounted so we don't `setState`
  // after unmount when a proof finishes in the background.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Probe on mount — cheap, and lets the UI show / hide the Ghost Mode
  // toggle before the user attempts anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await probeWorker();
      if (cancelled || !mounted.current) return;
      setBackend(result.backend);
      setCircuitVersion(result.circuitVersion);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generateWithdrawProof = useCallback(
    async (input: ProofGenInput): Promise<ProofGenResult> => {
      if (mounted.current) {
        setIsProving(true);
        setProgress({ phase: "loading-circuit", fraction: 0.01 });
        setLastResult(null);
      }

      const result = await proveWithdrawViaWorker(input, (p) => {
        // The worker invokes this proxy from a different realm; React
        // will batch the update on the next microtask.
        if (mounted.current) setProgress(p);
      });

      if (mounted.current) {
        setLastResult(result);
        setIsProving(false);
        // Normalise terminal phase: success → done, otherwise error.
        if (result.ok) {
          setProgress({ phase: "done", fraction: 1 });
        } else {
          const failureMessage = result.unavailable
            ? result.reason
            : result.error;
          setProgress((prev) =>
            prev.phase === "error"
              ? prev
              : { phase: "error", fraction: 1, message: failureMessage },
          );
        }
      }
      return result;
    },
    [],
  );

  const abort = useCallback(async () => {
    await abortInFlight();
    if (mounted.current) {
      setProgress({ phase: "aborted", fraction: 0 });
      setIsProving(false);
    }
  }, []);

  return {
    backend,
    circuitVersion,
    ready,
    progress,
    isProving,
    lastResult,
    generateWithdrawProof,
    abort,
  };
}

/**
 * Public hook surface. Documented call site:
 *
 * ```ts
 * const { generateWithdrawProof, progress, abort, backend } = useProofGen();
 * if (backend === "unavailable") return <GhostModeUnavailable />;
 * const result = await generateWithdrawProof({ witness, context });
 * if (!result.ok) { ... }
 * // result.proof feeds FxPrivacyEntrypoint.relayCrossCurrency(...)
 * ```
 */
export function useProofGen(): UseProofGenReturn {
  return useNoirWorker();
}
