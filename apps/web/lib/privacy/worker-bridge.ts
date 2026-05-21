/**
 * Comlink bridge between the main thread and the proof-gen Web Worker.
 *
 * Two responsibilities:
 *   1. Spawn the worker (Next.js 16 `new Worker(new URL(...), { type: "module" })`
 *      pattern — Turbopack picks this up natively, no webpack rule needed).
 *   2. Wrap it with comlink so the worker's `ProofWorkerApi` looks like a
 *      plain async object to the React hook.
 *
 * Why a single shared worker per tab:
 *   The proof-gen wasm + proving key together are ~2.5MB. We hold a
 *   single instance per tab and lazily spawn on first use. Aborting a
 *   proof terminates the worker — the next call spawns a fresh one
 *   (cheap; the browser caches the wasm + circuit JSON).
 *
 * SSR safety:
 *   This module touches `Worker` and `URL`, which only exist in the
 *   browser. Guard with `typeof window` checks at every entry point so
 *   the React tree can render server-side without exploding.
 */

import type {
  ProofGenInput,
  ProofGenProgress,
  ProofGenResult,
  ProofWorkerApi,
  ProverBackend,
} from "./types";

/**
 * Lazy comlink import — avoids shipping ~3KB to the SSR bundle.
 */
async function getComlink() {
  const mod = await import("comlink");
  return mod;
}

interface WorkerHandle {
  worker: Worker;
  api: ProofWorkerApi;
  /** Returned by comlink — releases proxy callbacks. */
  release(): void;
}

let handlePromise: Promise<WorkerHandle | null> | null = null;

/**
 * Spawn the worker once per tab. Returns `null` when called server-side.
 * Subsequent calls return the same promise.
 */
function getWorker(): Promise<WorkerHandle | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return Promise.resolve(null);
  }
  if (handlePromise) return handlePromise;

  handlePromise = (async () => {
    try {
      const Comlink = await getComlink();
      // The `?worker` syntax + `new URL(..., import.meta.url)` is the
      // Next.js 16 / Turbopack canonical worker spawn pattern. Type as
      // `module` so the worker can use top-level `import`s.
      const worker = new Worker(
        new URL("../../workers/proof-gen.worker.ts", import.meta.url),
        { type: "module", name: "bufi-proof-gen" },
      );
      const api = Comlink.wrap<ProofWorkerApi>(worker);
      return {
        worker,
        api,
        release() {
          // comlink's wrap doesn't allocate persistent proxies, but
          // calling `releaseProxy` is the documented way to let the GC
          // collect any callback proxies passed in via `Comlink.proxy`.
          try {
            (api as unknown as { [Comlink.releaseProxy]?: () => void })[
              Comlink.releaseProxy
            ]?.();
          } catch {
            /* best effort */
          }
        },
      };
    } catch (err) {
      // Worker spawn failed (CSP, unsupported, ...) — surface as
      // "unavailable" so the hook degrades gracefully.
      console.warn("[privacy] proof-gen worker failed to spawn", err);
      handlePromise = null;
      return null;
    }
  })();

  return handlePromise;
}

/**
 * Tear down the current worker (used by `abort()` and on hot-reload).
 */
export async function disposeWorker() {
  const handle = await handlePromise?.catch(() => null);
  if (handle) {
    handle.release();
    handle.worker.terminate();
  }
  handlePromise = null;
}

/**
 * Probe the worker for prover availability. Cheap; safe to call on mount
 * to drive UI affordances (e.g. hiding the "Ghost Mode" toggle when no
 * circuit is provisioned).
 */
export async function probeWorker(): Promise<{
  backend: ProverBackend;
  circuitVersion?: string;
}> {
  const handle = await getWorker();
  if (!handle) return { backend: "unavailable" };
  try {
    return await handle.api.probe();
  } catch (err) {
    console.warn("[privacy] probe failed", err);
    return { backend: "unavailable" };
  }
}

/**
 * Run a proof. Returns the worker's result envelope (which already
 * distinguishes `unavailable` from `error`).
 */
export async function proveWithdrawViaWorker(
  input: ProofGenInput,
  onProgress?: (p: ProofGenProgress) => void,
): Promise<ProofGenResult> {
  const handle = await getWorker();
  if (!handle) {
    return {
      ok: false,
      unavailable: true,
      reason: "Web Worker not available in this environment.",
    };
  }
  const Comlink = await getComlink();
  // comlink wraps the callback as a transferable proxy so the worker can
  // call back into the main thread without re-marshalling everything.
  const proxiedProgress = onProgress ? Comlink.proxy(onProgress) : undefined;
  try {
    return await handle.api.proveWithdraw(input, proxiedProgress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, unavailable: false, error: message };
  }
}

/**
 * Abort the in-flight proof (if any) by terminating the worker. The
 * caller is responsible for ignoring the eventual rejected promise from
 * `proveWithdrawViaWorker`.
 */
export async function abortInFlight() {
  await disposeWorker();
}
