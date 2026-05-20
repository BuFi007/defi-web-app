/**
 * Web Worker entrypoint for client-side Groth16 proof generation.
 *
 * Spawned by `apps/web/lib/privacy/worker-bridge.ts` via the Next.js 16
 * canonical pattern:
 *   new Worker(new URL("../../workers/proof-gen.worker.ts", import.meta.url),
 *              { type: "module" })
 *
 * Turbopack picks this up natively — no custom webpack rule required.
 * The worker bundle pulls in noir.js + barretenberg (or snarkjs on the
 * fallback path) PLUS the compiled circuit JSON, all loaded lazily so
 * the bundle stays small until the user opens the privacy flow.
 *
 * The worker exposes a comlink-style API (see `ProofWorkerApi` in
 * lib/privacy/types.ts). Progress callbacks are passed in as
 * `Comlink.proxy(...)` from the main thread; we invoke them at
 * deterministic milestones so the UI can render a real progress bar.
 *
 * Crash safety:
 *   - `proveWithdraw` NEVER throws across the comlink boundary; it
 *     returns a `ProofGenResult` envelope that already encodes
 *     "unavailable" vs "error".
 *   - If the worker itself crashes (OOM, wasm abort), comlink rejects
 *     the awaiting promise — the main-thread bridge converts that into
 *     `{ ok: false, unavailable: false, error: ... }`.
 */

/// <reference lib="webworker" />

import { loadProver, CIRCUIT_FILENAME, type Prover } from "../lib/privacy/noir-client";
import type {
  ProofGenInput,
  ProofGenProgress,
  ProofGenResult,
  ProofWorkerApi,
  ProverBackend,
} from "../lib/privacy/types";

// Lazy comlink import — keeps the worker startup hot path tight.
async function getComlink() {
  const mod = await import("comlink");
  return mod;
}

/**
 * Resolve the circuit JSON URL relative to the worker's own location.
 * This works for both the Turbopack dev server (where the worker is
 * served from `/.next/...`) and the production build.
 */
function circuitUrl(): URL {
  return new URL(`../lib/privacy/circuits/${CIRCUIT_FILENAME}`, import.meta.url);
}

let proverPromise: Promise<Prover> | null = null;

function getProver(): Promise<Prover> {
  if (!proverPromise) {
    proverPromise = loadProver(circuitUrl());
  }
  return proverPromise;
}

const api: ProofWorkerApi = {
  async probe(): Promise<{ backend: ProverBackend; circuitVersion?: string }> {
    try {
      const prover = await getProver();
      return { backend: prover.backend, circuitVersion: prover.circuitVersion };
    } catch (err) {
      // Should be unreachable — loadProver swallows everything — but be
      // defensive so the worker NEVER crashes the main thread.
      console.warn("[proof-gen.worker] probe failed", err);
      return { backend: "unavailable" };
    }
  },

  async proveWithdraw(
    input: ProofGenInput,
    onProgress?: (progress: ProofGenProgress) => void,
  ): Promise<ProofGenResult> {
    const emit = (p: ProofGenProgress) => {
      try {
        onProgress?.(p);
      } catch {
        /* progress callbacks must never break the prover */
      }
    };

    emit({ phase: "loading-circuit", fraction: 0.05 });
    let prover: Prover;
    try {
      prover = await getProver();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ phase: "error", fraction: 1, message });
      return { ok: false, unavailable: false, error: message };
    }

    if (prover.backend === "unavailable") {
      emit({
        phase: "error",
        fraction: 1,
        message: "Circuit not provisioned",
      });
      return {
        ok: false,
        unavailable: true,
        reason:
          "Circuit not provisioned. Drop `withdraw.json` into apps/web/lib/privacy/circuits/ (see README).",
      };
    }

    try {
      const proof = await prover.prove(input, emit);
      emit({ phase: "done", fraction: 1 });
      return { ok: true, proof };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ phase: "error", fraction: 1, message });
      return { ok: false, unavailable: false, error: message };
    }
  },
};

// Expose to the main thread via comlink. The `void` annotation silences
// the "floating promise" lint — comlink.expose() doesn't await anything
// resolvable from the worker side.
void (async () => {
  const Comlink = await getComlink();
  Comlink.expose(api);
})();
