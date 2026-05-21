# Privacy circuit artifacts

This directory holds the compiled Groth16 circuit artifact that
`apps/web/lib/privacy/noir-client.ts` loads at runtime to generate
withdrawal proofs for `FxPrivacyEntrypoint.relayCrossCurrency(...)`.

**Nothing here is committed in PR #46.** The artifact lands as part of
the privacy-hook slice-3 merge (fx-telarana#27). Until then, the
proof-gen hook returns `{ unavailable: true }` and the UI degrades
gracefully (no errors, no console noise).

## What gets dropped here

A single file:

```
apps/web/lib/privacy/circuits/withdraw.json
```

Layout (matches `CircuitArtifact` in `../noir-client.ts`):

```jsonc
{
  "version": "<commit-hash-of-fx-telarana@feat/privacy-hook-slice-3-crossccy>",
  "noir": {
    "bytecode": "0x...",        // ACIR program (Noir → JSON output)
    "abi": { ... },             // Circuit ABI (Noir output)
    "noir_version": "0.34.0"    // For diagnostic logging
  },
  "snarkjs": {
    "wasm": "./withdraw.wasm",  // r1cs wasm, relative to this file
    "zkey": "./withdraw.zkey"   // proving key, relative to this file
  }
}
```

The `noir` and `snarkjs` blocks are BOTH optional individually — at
least one must be present. `loadProver()` tries Noir first (faster,
matches the upstream toolchain), then snarkjs (slower fallback for
older browsers).

## Where the artifact comes from

The Noir source for the withdraw circuit lives in `fx-telarana` on the
`feat/privacy-hook-slice-3-crossccy` branch:

```
fx-telarana/contracts/lib/privacy-pools/circuits/withdraw.nr
```

The 0xbow upstream is vendored at the same commit hash you pin into
`version` above. The compilation step is canonical Noir:

```bash
# inside fx-telarana@feat/privacy-hook-slice-3-crossccy
cd contracts/lib/privacy-pools/circuits
nargo compile                              # → target/withdraw.json (ACIR + ABI)

# Optional snarkjs fallback artifacts:
snarkjs r1cs to_circom target/withdraw.r1cs withdraw.circom
snarkjs groth16 setup withdraw.r1cs <ptau> withdraw.zkey

# Stitch the manifest:
node scripts/build-circuit-manifest.mjs \
  --noir target/withdraw.json \
  --wasm target/withdraw.wasm \
  --zkey withdraw.zkey \
  --version "$(git rev-parse HEAD)" \
  --out apps/web/lib/privacy/circuits/withdraw.json
```

(The `build-circuit-manifest.mjs` script lives in fx-telarana
alongside the circuits — it's NOT shipped in this PR.)

## Version pinning

The `version` string in `withdraw.json` is the **commit hash of the
slice-3 branch** the artifact was compiled from. The hook surfaces it
via `useProofGen().circuitVersion` so production builds can assert that
the circuit matches the verifier contract deployed at the same hash.

Bumping the circuit MUST be done in lockstep with the verifier — they
share the proving/verifying key and a mismatch will fail proof
verification on-chain (silent revert).

## Depth of the Merkle path

The slice-3 circuit at the time of writing is compiled with depth = 32.
The proof-builder validates this via `validateMerklePath(path, 32)`. If
the upstream circuit changes depth, update both:

1. `apps/web/lib/privacy/use-proof-gen.ts` documented call-site sample
2. Any caller that hard-codes the depth constant

## Fallback when absent

`noir-client.ts::loadProver()` calls `fetch(circuit_url)` and on 404
returns an `UnavailableProver`. The hook surfaces this as
`{ backend: "unavailable" }`, and `generateWithdrawProof(...)` returns
`{ ok: false, unavailable: true, reason: "..." }`.

The build does NOT depend on `withdraw.json` being present.
`bun run --filter ./apps/web build` succeeds with an empty `circuits/`
dir (only the `.gitkeep` and this README ship in PR #46).

## Bundle size

| File             | Size (compressed) | When loaded                 |
| ---------------- | ----------------- | --------------------------- |
| withdraw.json    | ~1-2 MB           | First call to the hook      |
| noir wasm        | ~1.2 MB           | First call to the hook      |
| snarkjs (fallback) | ~1.4 MB         | ONLY when Noir fails to load |

The worker bundle stays out of the main app chunk thanks to the
`new Worker(new URL(...), { type: "module" })` pattern + Turbopack's
native worker support. Verify with `next build --turbopack --stats`
once the circuit lands.
