/**
 * Privacy proof-gen types.
 *
 * Mirrors the shape of inputs consumed by the 0xbow privacy-pools-core
 * `WithdrawProof` circuit and the calldata layout
 * `FxPrivacyEntrypoint.relayCrossCurrency(withdrawal, proof, scope)` expects
 * on the contract side. Keep this file dependency-free so it can be
 * imported from both the main thread AND the Web Worker without dragging
 * any wagmi/react surface into the worker bundle.
 *
 * Reference (consumer-side, do NOT import here — see README):
 *   fx-telarana `feat/privacy-hook-slice-3-crossccy`
 *     contracts/src/FxPrivacyEntrypoint.sol
 *     contracts/lib/privacy-pools/circuits/withdraw.circom
 */

import type { Address, Hex } from "viem";

/**
 * Hex-encoded 32-byte field element. We carry these as strings (NOT bigints)
 * across the worker boundary so structured-clone semantics stay cheap and
 * comlink doesn't need a custom transferable for `bigint`.
 */
export type FieldHex = Hex;

/**
 * Merkle path that authenticates the user's commitment inside the privacy
 * pool's append-only state tree. The 0xbow circuit consumes:
 *   - `siblings[depth]` — neighbour hashes along the path
 *   - `indices[depth]`  — left/right bits per level (0 = left, 1 = right)
 *   - `root` — the pool root the proof is bound to
 *
 * `depth` MUST match the circuit constant the artifact was compiled with
 * (slice-3 ships depth = 32 at the time of writing — pin in circuits/README).
 */
export interface MerklePath {
  root: FieldHex;
  siblings: FieldHex[];
  indices: number[];
}

/**
 * Context bytes the privacy entrypoint hashes into the proof so a relayer
 * cannot front-run by swapping the user's withdrawal target. The contract
 * recomputes `keccak256(abi.encode(...))` and asserts equality against
 * `publicSignals.context`. Field names are load-bearing — keep them in
 * sync with `FxPrivacyEntrypoint._encodeContext` on the slice-3 branch.
 */
export interface WithdrawContext {
  buyToken: Address;
  minBuyAmount: bigint;
  recipient: Address;
  /** chain id this proof will be relayed against */
  chainId: number;
  /** Optional ABI-encoded swap calldata the relayer must forward verbatim. */
  swapData?: Hex;
}

/**
 * Private witness the circuit consumes. The witness MUST NEVER leave the
 * worker (and ideally not even the user's machine — this is the whole
 * point of client-side proof gen). Treat instances of this type as toxic;
 * never log, never serialise to anything but the worker.
 */
export interface WithdrawWitness {
  /** Pre-image of the on-chain commitment (secret). */
  commitment: FieldHex;
  /** Nullifier secret — revealed publicly post-spend to block double-spend. */
  nullifier: FieldHex;
  /** Authenticating Merkle path. */
  merklePath: MerklePath;
  /** Amount being withdrawn (matches the commitment's value field). */
  value: bigint;
}

/**
 * Aggregate input the hook accepts. The worker derives the circuit-shaped
 * witness object from this — splitting WITNESS (secret) from CONTEXT
 * (public) makes it obvious which fields are sensitive.
 */
export interface ProofGenInput {
  witness: WithdrawWitness;
  context: WithdrawContext;
}

/**
 * Groth16 proof object — matches the calldata layout the privacy
 * entrypoint expects (a/b/c points + the array of public signals). The
 * exact byte layout is defined by the verifier contract; we serialise as
 * hex so the caller can `encodeAbiParameters` it directly.
 */
export interface WithdrawProof {
  a: [FieldHex, FieldHex];
  b: [[FieldHex, FieldHex], [FieldHex, FieldHex]];
  c: [FieldHex, FieldHex];
  /**
   * Public signals in the order the circuit declares them. Slice-3
   * circuit (at time of writing) declares:
   *   [root, nullifierHash, contextHash, value]
   * Verify against the circuit's `withdraw.json` ABI when slice-3 lands.
   */
  publicSignals: FieldHex[];
}

/**
 * Worker → main-thread progress events. The witness-gen step is fast
 * (<100ms typically); the bulk of the time is `prove`. We emit explicit
 * phase changes + a 0..1 fraction so the UI can show either a spinner or
 * an actual progress bar.
 */
export type ProofGenPhase =
  | "idle"
  | "loading-circuit"
  | "building-witness"
  | "proving"
  | "verifying"
  | "done"
  | "error"
  | "aborted";

export interface ProofGenProgress {
  phase: ProofGenPhase;
  /** 0.0 - 1.0 — monotonically increasing across a single run. */
  fraction: number;
  /** Human-readable, English-only, safe to render to console.log on failure. */
  message?: string;
}

/**
 * Result envelope from the worker. We model "circuit not provisioned" as a
 * first-class success-with-unavailable so the UI can degrade gracefully
 * before the slice-3 contracts ship.
 */
export type ProofGenResult =
  | { ok: true; proof: WithdrawProof }
  | { ok: false; unavailable: true; reason: string }
  | { ok: false; unavailable: false; error: string };

/**
 * Which proving backend ended up running. Surfaced so the caller can log
 * "fell back to snarkjs" without inspecting the worker internals.
 */
export type ProverBackend = "noir" | "snarkjs" | "unavailable";

/**
 * Public contract of the worker, as exposed via comlink. Keep this in
 * sync with `apps/web/workers/proof-gen.worker.ts`.
 */
export interface ProofWorkerApi {
  /**
   * Probe whether a circuit + prover are available WITHOUT generating a
   * proof. Cheap; safe to call on mount to decide whether to render the
   * "Ghost Mode" UI affordance.
   */
  probe(): Promise<{ backend: ProverBackend; circuitVersion?: string }>;
  /**
   * Generate a Groth16 withdrawal proof. The optional `onProgress`
   * callback is wrapped by comlink as a `Comlink.proxy` from the caller.
   */
  proveWithdraw(
    input: ProofGenInput,
    onProgress?: (progress: ProofGenProgress) => void,
  ): Promise<ProofGenResult>;
}
