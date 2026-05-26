# Team DELTA — Iteration 2

**Date:** 2026-05-24
**Branch:** feat/wk1n14-privacy-pools-live (HEAD d7dc2ba)
**Main HEAD:** 628fe10

## DELTA.1 — PR + branch state

**Open PRs: 2** (after this iteration)

| # | Title | Branch | Base | Mergeable | CI |
|---|---|---|---|---|---|
| 119 | fix(tests): isolate Playwright e2e from `bun test` discovery | fix/wk1-i1-delta-exclude-e2e-from-bun-test | main | MERGEABLE | Vercel SUCCESS, Typecheck+Unit+Smoke SUCCESS, CodeQL SUCCESS, **Local Perps Canary FAILURE**, Live Arc Canary SKIPPED |
| 120 | fix(dynamic): networkValidationMode type fix (NEW this iter) | fix/wk1-i2-delta-networkvalidationmode-type | feat/wk1n14-privacy-pools-live | pending | running |

### Integration-branch merge recommendation

**feat/wk1n14-privacy-pools-live → main: NO — not yet.**

Branch is +27 commits ahead of main (last merge was c9500c7 on 2026-05-22). Blockers before landing:

1. **ALPHA hydration** is still RED per iter 1 SUMMARY (DOM has 0 reactFiber keys). Cannot ship a non-hydrating `/` to main.
2. **BRAVO matcher** produces 0 fills across 13.9h — iter 1 still RED.
3. **CHARLIE 3 deployment bugs** (MXNB/QCAD/cirBTC missing from Arc deployments table, cirBTC decimals = 6 should be 8, ArcTestnet.nativeCurrency.decimals = 18 wrong) not yet patched.
4. PR #119 + PR #120 should land **first** (small, safe fixes targeting main and the integration branch). Then re-baseline.

**Land order recommendation:**
1. Merge PR #119 → main (it's been green-ish for >24h; the Perps Canary FAILURE looks unrelated to the e2e rename — verify with one re-run).
2. Merge PR #120 → feat/wk1n14-privacy-pools-live (unblocks integration-branch typecheck).
3. Rebase feat/wk1n14-privacy-pools-live onto main after #119.
4. Land feat/wk1n14-privacy-pools-live → main only when ALPHA + BRAVO + CHARLIE clear their iter 2 blockers.

## DELTA.2 — typecheck/build

**On feat/wk1n14-privacy-pools-live HEAD (d7dc2ba, before fix):**
- typecheck: **FAIL** — `apps/web/context/DynamicProviders.tsx(95,9): TS2322 — Type '"withoutSigning"' is not assignable to type 'NetworkValidationMode | undefined'`
- Regression introduced by ce136b8 / commits during iter 1 (Dynamic SDK only accepts `'always' | 'sign-in' | 'never'`)

**After PR #120 fix:**
- typecheck: **PASS** (`@bufi/web typecheck: Exited with code 0`)
- build: **PASS** (Next.js 16.2.6 Turbopack, 10/10 static pages, 41s compile + 24s TS)

**On main (worktree at 628fe10):**
- typecheck: **PASS** (all workspaces, no errors)
- build: not re-run on main (iter 1 confirmed PASS, no main commits since)

**Vercel deploy status:** unable to query — `mcp__claude_ai_Vercel__list_deployments` returns 403 Forbidden (BuFi team scope, same as iter 1; needs re-auth). PR #119's `Vercel` status context shows SUCCESS on its preview (8wdF3rr4JifrHvZdYJtrC7oFDsXm), so Vercel infra is operational, just not queryable from this MCP token.

## DELTA.3 — Test stability

`bun test` from repo root, 3 consecutive runs on feat/wk1n14-privacy-pools-live:

| Run | Pass | Fail | Errors | Files | Time |
|---|---|---|---|---|---|
| 1 | 217 | 224 | 210 | 247 | 35.5s |
| 2 | 217 | 224 | 210 | 247 | 35.4s |
| 3 | 217 | 224 | 210 | 247 | 33.6s |

**Deterministic — no flakes.** All 224 failures fall into 2 buckets:

1. `references/dydxprotocol-v4-chain/...` + `references/drift-labs-protocol-v2/...` — **221 fails.** The `references/` directory is gitignored (`.gitignore:52: references/`) — these are local-only vendored upstream repos that were never meant to run under our `bun test`. They are NOT part of either branch and NOT counted by CI. Main worktree shows **123 pass / 0 fail / 20 files / 836ms** — the true scope.
2. `apps/web/e2e/*.spec.ts` (3 files) — **3 fails.** Playwright tests that bun runner mis-claims. Already fixed by PR #119 (rename to `*.e2e.ts`). PR #119 has not yet been rebased into the integration branch.

**Quarantine:** none needed. Add a `bunfig.toml` `[test] ignore = ["references/", "**/*.e2e.ts"]` follow-up to make local `bun test` match CI scope (deferred — not blocking iter 2).

**e2e:** skipped (would need Playwright + Chromium boot, >5min budget per skill constraints).

## Headline

- **Branch is mergeable: NO** — needs PR #120 (or equivalent) for typecheck, plus iter 2 fixes from ALPHA / BRAVO / CHARLIE before landing on main.
- **Main remains green: YES** — main worktree shows 123 pass / 0 fail / typecheck clean. No DELTA-detected regression on main.
- **Net new this iter:** PR #120 (typecheck fix for iter-1-introduced regression in DynamicProviders.tsx).
