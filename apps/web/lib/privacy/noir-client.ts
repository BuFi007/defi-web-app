/**
 * Lazy-loaded NoirJS adapter with a snarkjs fallback.
 *
 * Why two backends:
 *   - noir.js (preferred) is the official 0xbow path — same prover the
 *     circuits were authored against, ~2-8s on consumer hardware, ships
 *     with a ~1.2MB wasm blob.
 *   - snarkjs (fallback) is slower (5-10×) but works on older browsers
 *     and tighter CSPs. It's a ~1.4MB JS dep — lazy-load ONLY on the
 *     fallback path so we don't pay the cost in the happy case.
 *
 * Both packages are intentionally imported with `import("…")` (dynamic
 * import). Two reasons:
 *   1. Keeps the main bundle slim — the wasm + prover only ship to users
 *      who actually open the privacy flow.
 *   2. Lets us swallow a "module not found" / "wasm load failed" error
 *      and fall through to the next backend without crashing the worker.
 *
 * This module is designed to run INSIDE the Web Worker
 * (`apps/web/workers/proof-gen.worker.ts`). It does NOT use any DOM,
 * window, or React API.
 */

import type {
  FieldHex,
  ProofGenInput,
  ProofGenProgress,
  ProverBackend,
  WithdrawProof,
} from "./types";

/**
 * Minimal snarkjs surface we depend on. The upstream package ships no
 * types; declaring the slice we use locally is cheaper than pulling in
 * `@types/snarkjs` (community-maintained, often stale).
 */
interface SnarkjsModule {
  groth16: {
    fullProve(
      inputs: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicSignals: string[];
    }>;
  };
}

/**
 * Where the worker will look for the compiled circuit artifact. We
 * resolve relative to the worker's URL via `new URL(..., import.meta.url)`
 * at the call site (see proof-gen.worker.ts). The bytes live in
 * `apps/web/lib/privacy/circuits/withdraw.json` once provisioned (see
 * circuits/README.md).
 */
export const CIRCUIT_FILENAME = "withdraw.json";

/**
 * Minimal shape the worker actually needs from the circuit artifact.
 * Captures BOTH the noir.js layout (`bytecode`, `abi`, `noir_version`)
 * AND the snarkjs layout (`wasm`, `zkey`) so a single JSON manifest can
 * carry either. Provisioning script should populate whichever fields the
 * upstream toolchain exports.
 */
export interface CircuitArtifact {
  /** Commit hash of the slice-3 branch the circuit was compiled from. */
  version: string;
  noir?: {
    /** Hex-encoded ACIR program (Noir output). */
    bytecode: string;
    /** ABI JSON describing the circuit's inputs. */
    abi: unknown;
    /** Noir compiler version used to produce `bytecode`. */
    noir_version?: string;
  };
  snarkjs?: {
    /** URL (relative to this file) of the r1cs `.wasm`. */
    wasm: string;
    /** URL (relative to this file) of the proving key `.zkey`. */
    zkey: string;
  };
}

/**
 * Common prover interface both backends conform to. The worker only ever
 * sees this shape, which keeps the rest of the worker backend-agnostic.
 */
export interface Prover {
  backend: ProverBackend;
  circuitVersion?: string;
  /**
   * Run the proof. The implementation calls `onProgress` at deterministic
   * milestones so the UI can render a real progress bar.
   */
  prove(
    input: ProofGenInput,
    onProgress?: (p: ProofGenProgress) => void,
  ): Promise<WithdrawProof>;
}

/**
 * Sentinel prover used when no circuit JSON has been provisioned. The
 * worker still loads cleanly; the hook surfaces `{ unavailable: true }`.
 */
class UnavailableProver implements Prover {
  backend: ProverBackend = "unavailable";
  prove(): Promise<WithdrawProof> {
    return Promise.reject(
      new Error(
        "Circuit not provisioned. See apps/web/lib/privacy/circuits/README.md",
      ),
    );
  }
}

/**
 * Fetch the circuit artifact from a URL co-located with the worker. The
 * absence of the file MUST NOT throw — we return `null` so callers can
 * decide between "fall back" and "surface unavailable".
 */
async function tryLoadArtifact(
  circuitUrl: URL,
): Promise<CircuitArtifact | null> {
  try {
    const res = await fetch(circuitUrl.toString(), { cache: "force-cache" });
    if (!res.ok) return null;
    return (await res.json()) as CircuitArtifact;
  } catch {
    // network error, 404, or invalid JSON — all mean "not provisioned".
    return null;
  }
}

/**
 * Build the field-level inputs the circuit expects from the
 * worker-friendly `ProofGenInput` shape. Kept out of `proof-builder.ts`
 * to avoid a circular dep (proof-builder is for main-thread callers).
 */
function buildCircuitInputs(input: ProofGenInput): Record<string, unknown> {
  // Order/naming must match the circuit ABI exported by the slice-3
  // build. We DON'T import the ABI at compile time because the artifact
  // doesn't exist in this PR — the worker validates field presence at
  // runtime once the JSON lands.
  return {
    commitment: input.witness.commitment,
    nullifier: input.witness.nullifier,
    root: input.witness.merklePath.root,
    path_elements: input.witness.merklePath.siblings,
    path_indices: input.witness.merklePath.indices,
    value: input.witness.value.toString(),
    buy_token: input.context.buyToken,
    min_buy_amount: input.context.minBuyAmount.toString(),
    recipient: input.context.recipient,
    chain_id: input.context.chainId.toString(),
  };
}

async function loadNoir(artifact: CircuitArtifact): Promise<Prover | null> {
  if (!artifact.noir?.bytecode) return null;
  try {
    // Both packages are listed under `optionalDependencies` in
    // apps/web/package.json. If installed → TS resolves them here. If
    // skipped at install time (small-bundle dev builds) → the dynamic
    // import throws and we fall through to snarkjs.
    const noirjs = await import("@noir-lang/noir_js");
    const backend = await import("@noir-lang/backend_barretenberg");

    const Noir = noirjs.Noir as unknown as new (...args: unknown[]) => {
      execute: (
        inputs: Record<string, unknown>,
      ) => Promise<{ witness: Uint8Array }>;
    };
    const BarretenbergBackend =
      backend.BarretenbergBackend as unknown as new (...args: unknown[]) => {
        generateProof: (witness: Uint8Array) => Promise<{
          proof: Uint8Array;
          publicInputs: string[];
        }>;
      };

    const program = { bytecode: artifact.noir.bytecode, abi: artifact.noir.abi };
    const noir = new Noir(program);
    const bb = new BarretenbergBackend(program);

    return {
      backend: "noir",
      circuitVersion: artifact.version,
      async prove(input, onProgress) {
        onProgress?.({ phase: "building-witness", fraction: 0.15 });
        const inputs = buildCircuitInputs(input);
        const { witness } = await noir.execute(inputs);

        onProgress?.({ phase: "proving", fraction: 0.45 });
        const { proof, publicInputs } = await bb.generateProof(witness);

        onProgress?.({ phase: "verifying", fraction: 0.9 });
        return encodeGroth16(proof, publicInputs);
      },
    };
  } catch (err) {
    // noir.js / barretenberg failed to load (wasm denied by CSP, package
    // missing, browser too old) — fall through to snarkjs.
    console.warn("[privacy] noir.js unavailable, falling back to snarkjs", err);
    return null;
  }
}

async function loadSnarkjs(artifact: CircuitArtifact): Promise<Prover | null> {
  if (!artifact.snarkjs?.wasm || !artifact.snarkjs?.zkey) return null;
  try {
    // Lazy-loaded optional dep (~1.4MB) — only paid for on fallback path.
    // snarkjs ships no types; declare the slice we use ambiently below.
    // @ts-expect-error - snarkjs has no published types
    const snarkjs: SnarkjsModule = await import("snarkjs");

    return {
      backend: "snarkjs",
      circuitVersion: artifact.version,
      async prove(input, onProgress) {
        onProgress?.({ phase: "building-witness", fraction: 0.1 });
        const inputs = buildCircuitInputs(input);

        onProgress?.({ phase: "proving", fraction: 0.4 });
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          inputs,
          artifact.snarkjs!.wasm,
          artifact.snarkjs!.zkey,
        );

        onProgress?.({ phase: "verifying", fraction: 0.9 });
        return normaliseSnarkjsProof(proof, publicSignals);
      },
    };
  } catch (err) {
    console.warn("[privacy] snarkjs unavailable", err);
    return null;
  }
}

/**
 * Marshal a raw Barretenberg proof + public inputs into the Groth16
 * calldata layout the verifier contract expects. The exact slicing is
 * documented on the verifier side; this implementation matches the
 * layout used by `snarkjs.groth16.exportSolidityCallData`.
 */
function encodeGroth16(
  proofBytes: Uint8Array,
  publicInputs: string[],
): WithdrawProof {
  // 8 field elements × 32 bytes = 256 bytes for a/b/c
  if (proofBytes.length < 256) {
    throw new Error(
      `Unexpected proof length: ${proofBytes.length} (expected >= 256)`,
    );
  }
  const hex = (start: number, end: number): FieldHex =>
    ("0x" +
      Array.from(proofBytes.slice(start, end))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as FieldHex;

  return {
    a: [hex(0, 32), hex(32, 64)],
    b: [
      [hex(64, 96), hex(96, 128)],
      [hex(128, 160), hex(160, 192)],
    ],
    c: [hex(192, 224), hex(224, 256)],
    publicSignals: publicInputs.map((s) => normaliseField(s)),
  };
}

function normaliseSnarkjsProof(
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  },
  publicSignals: string[],
): WithdrawProof {
  return {
    a: [normaliseField(proof.pi_a[0]), normaliseField(proof.pi_a[1])],
    b: [
      [normaliseField(proof.pi_b[0][0]), normaliseField(proof.pi_b[0][1])],
      [normaliseField(proof.pi_b[1][0]), normaliseField(proof.pi_b[1][1])],
    ],
    c: [normaliseField(proof.pi_c[0]), normaliseField(proof.pi_c[1])],
    publicSignals: publicSignals.map(normaliseField),
  };
}

function normaliseField(s: string): FieldHex {
  if (s.startsWith("0x")) return s as FieldHex;
  // snarkjs returns base-10 stringified bigints — convert to 0x-prefixed
  // 32-byte hex so the call-site can feed it straight into
  // `encodeAbiParameters([{ type: "uint256" }], [BigInt(value)])`.
  const hex = BigInt(s).toString(16).padStart(64, "0");
  return ("0x" + hex) as FieldHex;
}

/**
 * Public entrypoint used by the worker. Tries noir.js first, falls back
 * to snarkjs, and finally returns `UnavailableProver` if the circuit
 * isn't even provisioned. NEVER throws — surface failure via the
 * `backend === "unavailable"` sentinel.
 */
export async function loadProver(circuitUrl: URL): Promise<Prover> {
  const artifact = await tryLoadArtifact(circuitUrl);
  if (!artifact) return new UnavailableProver();
  const noir = await loadNoir(artifact);
  if (noir) return noir;
  const snark = await loadSnarkjs(artifact);
  if (snark) return snark;
  return new UnavailableProver();
}
