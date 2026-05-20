# Client-side Groth16 proof generation (Wave H3)

Operator / integrator-facing notes for the privacy proof-gen primitive
shipped in `apps/web/lib/privacy/`. This is the browser side of the
0xbow privacy hook — it builds the `WithdrawProof` consumed by
`FxPrivacyEntrypoint.relayCrossCurrency(...)` without sending the
witness to any server.

Scope: scaffolding only. The actual circuit `.json` artifact lands when
fx-telarana#27 (`feat/privacy-hook-slice-3-crossccy`) merges. Until then
the proof-gen hook reports `{ backend: "unavailable" }` and any UI that
calls it must hide the "Ghost Mode" affordance.

## TL;DR for operators

| Question                                          | Answer                                                 |
| ------------------------------------------------- | ------------------------------------------------------ |
| Is the witness sent anywhere?                     | No — proof is built inside a Web Worker on-device.     |
| How long does proof gen take?                     | 2-8s (Noir) / 10-40s (snarkjs fallback) on consumer HW. |
| What happens if the circuit isn't deployed yet?   | Hook returns `{ unavailable: true }`. No console noise. |
| Does this block the main thread?                  | No — runs in a Web Worker via comlink RPC.             |
| Can the user cancel a proof in flight?            | Yes — `useProofGen().abort()` terminates the worker.   |
| Does this need a `next.config.mjs` change?        | No. Next.js 16 + Turbopack handle the worker natively. |
| Does it run on Safari / Firefox?                  | Noir requires modern wasm + workers. snarkjs is the   |
|                                                   | broader-compat fallback.                                |

## Threat model

The proof binds the user's commitment + nullifier to a **withdrawal
context** (`buyToken`, `minBuyAmount`, `recipient`, `chainId`,
`swapData`). The on-chain entrypoint recomputes
`keccak256(abi.encode(context))` and asserts equality against the
proof's public signal. This means:

- A relayer **cannot** front-run by swapping the user's target token.
- A relayer **cannot** redirect the withdrawal to their own address.
- A relayer **cannot** lower the `minBuyAmount` to extract slippage.

If a relayer alters any field, the proof's context-hash check fails
inside the verifier — the transaction reverts on-chain. The user's
funds stay in the privacy pool; they can retry with the same witness
plus a fresh context.

The witness itself (commitment pre-image + nullifier) NEVER leaves the
Web Worker. The bridge transfers only:
- IN: the worker payload (witness + context, structured-cloned)
- OUT: `WithdrawProof` (a/b/c + public signals) — public data

## Where the witness comes from

A future PR will add `@bufi/privacy-pools` reader hooks that pull:

1. **Commitment** — the pre-image the user committed when they deposited
   into the pool. Stored in the user's wallet (encrypted with a wallet
   signature key, derived deterministically — see slice-3 spec).
2. **Nullifier** — derived from the same secret. Revealed publicly
   post-spend on-chain to prevent double-spend.
3. **Merkle path** — fetched from the on-chain pool state tree (or an
   indexer mirror — slice-3 will ship a Ponder schema for this).

Until those reader hooks ship, `proof-builder.ts::buildProofGenInput`
accepts these as plain arguments. Test integrations should mock them.

## Operator runbook

### Provisioning the circuit (slice-3 merge day)

1. Check out fx-telarana@feat/privacy-hook-slice-3-crossccy
2. Compile the Noir circuit: `cd contracts/lib/privacy-pools/circuits && nargo compile`
3. Run the manifest builder (lives in fx-telarana):
   ```bash
   node scripts/build-circuit-manifest.mjs \
     --noir target/withdraw.json \
     --version $(git rev-parse HEAD) \
     --out apps/web/lib/privacy/circuits/withdraw.json
   ```
4. Commit `withdraw.json` to defi-web-app via a separate PR (≥ 1MB, so
   it gets its own review).
5. Verify on staging: open the privacy page, confirm
   `useProofGen().backend === "noir"` and that
   `circuitVersion === <slice-3 commit hash>`.

### Verifying the deploy

Once the circuit is provisioned + a frontend page calls the hook:

```bash
# Build (must succeed even without circuit JSON — graceful absence)
bun run --filter ./apps/web build

# Smoke (run via /qa skill once a page exists)
bun run --filter ./apps/web e2e -- privacy-proof-gen
```

The hook surfaces three signals to the UI for operators:

- `backend === "unavailable"` → no circuit JSON. Hide Ghost Mode.
- `backend === "snarkjs"` → fallback path active. Warn user about
  slower proofs (10-40s instead of 2-8s).
- `circuitVersion !== EXPECTED_HASH` → mismatch vs the deployed
  verifier. Refuse to submit; show "please refresh" toast.

### Bundle audit

The worker bundle is OUT of the main app chunk. Verify with:

```bash
bun run --filter ./apps/web build
# Then inspect .next/static/chunks for proof-gen.worker.<hash>.js
```

It should NOT appear in the route-level JS payload — only loaded on
first call to the hook.

## CSP requirements

The worker uses wasm + dynamic `import()`. CSP must allow:

```
worker-src 'self';
script-src 'self' 'wasm-unsafe-eval';
```

If the production CSP is stricter, the worker will fall back to
snarkjs (which doesn't need wasm-unsafe-eval but is slower). If both
backends fail, the hook surfaces `unavailable` and the UI hides the
flow.

## Open questions for slice-3 merge

1. **Pool scope encoding** — is `scope` an opaque `bytes32` or a
   structured field? Affects how `relayCrossCurrency` is called from
   the frontend. Resolve when contracts land.
2. **Circuit depth** — confirmed 32 at scaffolding time. If
   slice-3 ships a different depth, update `validateMerklePath` calls.
3. **Pyth integration** — does the proof need to bind the Pyth update
   ID (so a relayer can't reorder oracle updates)? Will revisit when
   slice-3 + Pyth-Hermes wave reconcile.
