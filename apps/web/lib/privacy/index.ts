/**
 * Public surface for the BUFI privacy proof-gen library.
 *
 * Components / call sites should import from `@/lib/privacy`, not from
 * sibling modules. The internal split (noir-client / worker-bridge /
 * proof-builder) is an implementation detail.
 */

export type {
  FieldHex,
  MerklePath,
  ProofGenInput,
  ProofGenPhase,
  ProofGenProgress,
  ProofGenResult,
  ProofWorkerApi,
  ProverBackend,
  WithdrawContext,
  WithdrawProof,
  WithdrawWitness,
} from "./types";

export {
  buildProofGenInput,
  encodeWithdrawContext,
  hashWithdrawContext,
  validateMerklePath,
} from "./proof-builder";

export {
  abortInFlight,
  disposeWorker,
  probeWorker,
  proveWithdrawViaWorker,
} from "./worker-bridge";

export { useProofGen, type UseProofGenReturn } from "./use-proof-gen";
