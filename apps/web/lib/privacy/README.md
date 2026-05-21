# `@/lib/privacy` — client-side Groth16 proof generation

Wave H3 of the production-perps roadmap (Pillar 5 — Privacy stack).
Scaffolding for the browser-side proof gen that feeds
`FxPrivacyEntrypoint.relayCrossCurrency(withdrawal, proof, scope)` once
the slice-3 privacy hook lands (fx-telarana#27).

## Architecture

```
                ┌────────────────────────────────────────────┐
                │                React tree                  │
                │  ┌──────────────────────────────────────┐  │
                │  │  useProofGen()  (use-proof-gen.ts)   │  │
                │  └────────────────┬─────────────────────┘  │
                │                   │                        │
                │           comlink RPC over postMessage     │
                │                   │                        │
                │  ┌────────────────▼─────────────────────┐  │
                │  │  worker-bridge.ts                     │  │
                │  │   • spawns the Worker once per tab    │  │
                │  │   • wraps it with comlink             │  │
                │  └────────────────┬─────────────────────┘  │
                └───────────────────┼────────────────────────┘
                                    │
                ┌───────────────────▼────────────────────────┐
                │   workers/proof-gen.worker.ts (Web Worker) │
                │   ┌──────────────────────────────────────┐ │
                │   │  noir-client.ts                       │ │
                │   │   • fetches circuits/withdraw.json    │ │
                │   │   • tries Noir → falls back to snarkjs│ │
                │   │   • returns a `Prover`                │ │
                │   └──────────────────────────────────────┘ │
                └───────────────────────────────────────────┘
```

## Files

| File                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `types.ts`             | Witness / context / proof / progress / result types |
| `proof-builder.ts`     | Main-thread input assembly + context-hash helpers   |
| `noir-client.ts`       | Noir + snarkjs adapters, lives in the worker bundle |
| `worker-bridge.ts`     | Worker lifecycle + comlink wrapper                  |
| `use-proof-gen.ts`     | React hook surface                                  |
| `circuits/README.md`   | How to provision the circuit JSON (slice-3 merge)   |
| `index.ts`             | Public exports                                      |

`workers/proof-gen.worker.ts` lives outside this directory (under
`apps/web/workers/`) so Next.js's worker spawn pattern resolves cleanly
relative to `import.meta.url`.

## Call-site sketch

The privacy entrypoint is NOT wired into a page in this PR — that lands
when fx-telarana#27 merges and `FxPrivacyEntrypoint` ships an
address. The expected shape:

```ts
"use client";

import {
  buildProofGenInput,
  useProofGen,
  validateMerklePath,
} from "@/lib/privacy";

function GhostWithdrawButton(props: WithdrawProps) {
  const {
    generateWithdrawProof,
    progress,
    abort,
    backend,
    isProving,
    circuitVersion,
  } = useProofGen();

  // Hide the affordance entirely if the circuit isn't provisioned yet.
  if (backend === "unavailable") return null;

  const onClick = async () => {
    // 1. Assemble the witness from on-chain state (caller pulls
    //    `commitment`, `nullifier`, and the Merkle path from
    //    `@bufi/privacy-pools` reader hooks — added when slice-3 ships).
    validateMerklePath(props.merklePath, 32);

    const input = buildProofGenInput({
      commitment: props.commitment,
      nullifier: props.nullifier,
      merklePath: props.merklePath,
      value: props.value,
      buyToken: props.buyToken,
      minBuyAmount: props.minBuyAmount,
      recipient: props.recipient,
      chainId: props.chainId,
      swapData: props.swapData,
    });

    // 2. Generate the proof (2-8s — UI shows `progress.fraction` bar).
    const result = await generateWithdrawProof(input);
    if (!result.ok) {
      // Either unavailable (race against circuit provisioning) or a
      // hard failure (CSP, OOM, ...). Surface a toast.
      return;
    }

    // 3. Submit via wagmi `useWriteContract`:
    //
    //   await writeContract({
    //     address: fxPrivacyEntrypoint,
    //     abi: FxPrivacyEntrypointAbi,
    //     functionName: "relayCrossCurrency",
    //     args: [
    //       /* withdrawal */ { ... },
    //       /* proof      */ result.proof,
    //       /* scope      */ poolScope,
    //     ],
    //   });
  };

  return (
    <div>
      <button onClick={onClick} disabled={isProving}>Submit (Ghost Mode)</button>
      {isProving && (
        <progress value={progress.fraction} max={1}>
          {progress.phase} — {(progress.fraction * 100).toFixed(0)}%
        </progress>
      )}
      {isProving && <button onClick={abort}>Cancel</button>}
      {circuitVersion && (
        <span title={`Circuit @ ${circuitVersion}`}>Ghost Mode ready</span>
      )}
    </div>
  );
}
```

## Backend selection (Noir vs snarkjs)

`noir-client.ts::loadProver` tries Noir first. On any failure (wasm
denied by CSP, package missing, browser doesn't support BigInt64Array
in workers, etc.) it falls through to snarkjs.

| Backend  | Time on M1 | Bundle size (lazy)             | Compat            |
| -------- | ---------- | ------------------------------ | ----------------- |
| Noir     | ~2-8s      | ~1.2MB wasm                    | Modern browsers   |
| snarkjs  | ~10-40s    | ~1.4MB JS                      | Older / strict CSP |
| (none)   | —          | 0                              | Hook returns `unavailable` |

The hook surfaces the chosen backend via `useProofGen().backend` so the
UI can warn about the slower path. Reflect-style timing budgeting (per
the roadmap's Pyth-Hermes reconnect pattern) is unnecessary here — the
worker is local; there's no network leg to retry.

## Lifecycle / "Pyth-Hermes-style reconnect"

The roadmap calls out the Pyth-Hermes WebSocket reconnect pattern as
prior art for "long-lived browser primitives that may transiently
fail". The proof worker is similar in spirit but simpler:

- **Spawn once per tab** — on first `useProofGen()` mount, the bridge
  spawns a single Worker. Subsequent calls re-use it.
- **Cache the prover** — the Worker memoises `loadProver()` so the
  ~1.2MB wasm only initialises once per tab session.
- **Abort = terminate** — calling `abort()` calls `worker.terminate()`.
  The next call spawns a fresh worker; the browser keeps the wasm hot
  via HTTP cache (`Cache-Control: immutable` on `circuits/*`).
- **No exponential backoff** — there's no network leg to back off
  against. A `loadProver()` failure surfaces as `backend: "unavailable"`
  on the first probe; UI hides the affordance.

## Circuit provisioning

See [`./circuits/README.md`](./circuits/README.md). Nothing under
`circuits/` is committed in PR #46 except `.gitkeep` and that README.

## Next.js / Turbopack notes

The Worker spawn pattern
`new Worker(new URL("...", import.meta.url), { type: "module" })` is
natively supported by Next.js 16 + Turbopack — no `next.config.mjs`
delta required. Circuit JSON is loaded at runtime via `fetch()`, so
no special loader rule is needed either.

If a future maintainer wants to inline the wasm via webpack (instead
of lazy fetch), they'll need to add an `asset/resource` rule. This PR
keeps the lazy-fetch path because it lets the UI ship without the
artifact and degrade gracefully.

## Acceptance — Wave H3

- [x] Hook returns `{ unavailable: true }` when no circuit is present
- [x] Hook spawns a Worker (off main thread) so the tab doesn't freeze
- [x] Comlink RPC + progress callback proxy
- [x] Noir-first, snarkjs fallback, both lazy
- [x] Circuit JSON resolution + version pinning documented
- [x] No actual circuit committed (waits on fx-telarana#27)
