# MCP Dogfood Report — Private Stack + Bucket Analysis

> Run: 2026-05-29 · Target: `https://mcp.bu.finance` (prod, relayer now wired) · 4 amnesia loops · wallet `…6cc7`
> Question: with the relayer online, is the ghost/FxPrivacyEntrypoint/circuits stack at 100% per a completeness benchmark, across all assets + cross-currency?

## Headline

**The relayer verification PASSES on every loop.** `POST /api/ghost/relay` and `/api/ghost/swap` both return `relayerSubmission.available=TRUE` with a live endpoint (`relayer-api-production-b410.up.railway.app/v1/relay[CrossCurrency]`), and the relayer's own `/health` returns `{ok:true,dryRun:false,entrypoint:0xD11c…2736}` — so a withdrawal routes through the relayer and **does not leak the agent wallet as msg.sender**. Cross-currency is **live** (swapAdapter `0x3Fa1AcC8…` wired; the old `SwapAdapterNotSet` revert is resolved). All 6 pools deposit-able. `latestRoot` non-null.

## Per-loop results

| Loop | Status | Calls | Guesses | Src-leak | Verdict |
|---|---|---|---|---|---|
| same-asset private loop | partial | 9 | 0 | 0 | relayer TRUE, linter 100; stuck only at off-MCP Groth16 proof |
| cross-currency private loop | ✅ | 10 | 0 | 0 | cross-ccy LIVE + relayer TRUE; 100 USDC→~92 EURC |
| all-6-pool coverage | ✅ | 9 | 2 | 0 | all 6 deposits prepared, correct token/pool/decimals, 0 fail |
| completeness critic | ✅ | 13 | 0 | 0 | 6/8 criteria DONE; biggest gap = proof toolchain obtainability |

Zero source-leakage across all loops. Discovery efficient (first success ≤1–4 calls).

## Bucket-analysis scorecard — Ghost Privacy stack

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | All pools deposit-able | ✓ | 6 pools live; per-asset `deposit()` prepared (USDC/EURC/MXNB/QCAD 6-dec, cirBTC 18-dec, AUDF 6-dec) |
| 2 | Merkle root readable | ✓ | `ghost_pools.latestRoot` non-null, echoed in `relay.proofInputs.root` |
| 3 | Relayer available (no msg.sender leak) | ✓ | `relayerSubmission.available=true` + relayer `/health` 200 dryRun:false |
| 4 | Cross-currency live on-chain | ✓ | swapAdapter wired; `relayCrossCurrency` no longer reverts; rate 0.92 |
| 5 | Honest privacy disclosure | ✓ | `privacyNotice` (level weak, offChain operator-correlation) on every response |
| 6 | Privacy linter present | ✓ | `privacy-check` → 0–100 + coded risks + fixes + disclaimer |
| 7 | Proof construction obtainable | ◐→✓* | circuit was prose-only; **fixed this run** — llms.txt now gives the public 0xbow circuit `.wasm/.zkey` URLs + merkle-siblings source |
| 8 | Unlinkability (fixed denominations) | ✗ (by design) | anonymity set ≈1 by amount-matching; tracked: fixed denominations + anon-set gating (contract-side) |

**Score: 6.5/8 → ~81% before this run's fix; ~88% after** (criterion 7 closed for the *discoverability* half). Criterion 8 is a disclosed contract-side limitation, not an MCP gap.

## Fix applied this run (safe + additive)

`apps/hyper-mcp/src/app.ts` llms.txt "Constructing a ghost proof":
- Added the **public, resolvable circuit artifact URLs** (0xbow privacy-pools-core `withdraw.wasm` / `withdraw.zkey` at pinned commit `a80836a4`) so an integrator can run snarkjs directly even though the `@bu/fx-engine` / `@bu/privacy-prover` wrappers are internal.
- Documented that **leaf siblings are not served by the MCP** — rebuild the LeanIMT by scanning the entrypoint's `Deposited` events (or via the SDK data service).

## Remaining gaps (not MCP-fixable here)

1. **Proof toolchain packaging** — `@bu/fx-engine` + `@bu/privacy-prover` are `private:true` (not npm-published). Circuits are public (now documented); the convenience wrappers are not. Publishing them is an fx-telarana release task.
2. **No leaf-merkle-path endpoint** — integrators must scan chain to build the inclusion path. An optional MCP `/api/ghost/merkle-path?commitment=` endpoint would close this (replicates ASP read logic; review-gated).
3. **No cross-currency quote endpoint** — `minBuyAmount` / `relayFeeBPS` are caller-supplied; only `maxRelayFeeBPS=500` is disclosed. A small additive `ghost_swap` enhancement could suggest defaults.
4. **Unlinkability / fixed denominations** + **single-operator off-chain correlation** — disclosed, contract/infra-side (split operators or self-host).

## What's working (keep)

- `ghost_pools` is the single source of truth (pools + root + swapAdapter + routes + privacyNotice in one call).
- `relayerSubmission` block on relay/swap carries `available` + concrete endpoint + exact requestShape — unambiguous.
- Independent relayer `/health` check confirms real deployment, not an advertised-but-dead URL.
- llms.txt Ghost Mode section is exemplary (weak-privacy honesty, Poseidon scheme, 5-step proof flow, now with public circuit URLs).
