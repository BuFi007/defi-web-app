# Team DELTA — Iteration 1

## DELTA.1 — PR sweep

- Opened: 0 | Merged this run: 0 | Fixed-and-pushed: 0 | Still red: 0

`gh pr list --state open --limit 100` returned an empty result on
`BuFi007/defi-web-app` at the time of the sweep. No open PRs to triage,
merge, or rebase. Nothing to report on still-red queue.

If this is a surprise (other teams expected to find PRs open), the likely
explanation is that prior teams already merged or closed everything during
the same iteration window. Suggest the iteration-2 dispatch double-check
PR list freshness before assuming work exists here.

## DELTA.2 — Main typecheck / build

Run from the locked main worktree at
`/Users/criptopoeta/coding-dojo/defi-web-app/.claude/worktrees/agent-aef79022665157232`
(HEAD = `628fe10` "docs(planning): bucket analysis for FX Telaraña / BUFX").

- `bun install`: PASS (2849 packages, 27.95s)
- `bun run typecheck`: **PASS** — all 28 workspace packages exit 0
  (location, logger, perps-math, env, x402, shared-types, wallet,
  liveblocks, db, mcp, contracts, market-data, fx-bento, perps, fx-spot,
  keeper-runtime, ponder, fx-telarana, keeper-arcade-settler,
  keeper-perps-matcher, keeper-pyth, keeper-perps-funding, keeper-spot,
  keeper-perps-liquidator, keeper-gateway-signer,
  keeper-telarana-liquidator, api, web). The TS7026 JSX intrinsic error
  in `apps/web/utils/svgs.tsx` flagged in the brief is **not present** on
  current main.
- `bun run build`: **PASS** — `@bufi/web build: Exited with code 0`. All
  routes prerendered/built clean (Static + PPR + Dynamic + ƒ Middleware).
- `ioredis` is not referenced in `apps/api` source — every match in the
  repo lives inside `@sentry/nextjs` build artifacts under
  `apps/web/.next/`. No fix needed.

Fix PRs opened: **none required** — main typechecks and builds clean.

## DELTA.3 — Test stability

Run from the same main worktree. Three consecutive `bun test` invocations.

| Run | Pass | Fail | Errors | Files | Duration |
|-----|------|------|--------|-------|----------|
| 1   | 123  | 3    | 3      | 23    | 2.26s    |
| 2   | 123  | 3    | 3      | 23    | 1.15s    |
| 3   | 123  | 3    | 3      | 23    | 1.03s    |

**Deterministic** — same 3 files fail every run. NOT a flake.

Failing files (all in `apps/web/e2e/`):
- `arcade-bento-e2e.spec.ts`
- `loan-tab.spec.ts`
- `perps-panel.spec.ts`

Root cause: `bun test` discovers `*.spec.ts` across the whole monorepo and
tries to execute these Playwright files (`import { test } from "@playwright/test"`)
in the bun runner, which throws `Playwright Test did not expect test() to
be called here`. Two test runners colliding on the same glob.

### Fix shipped — PR #119

https://github.com/BuFi007/defi-web-app/pull/119
Branch: `fix/wk1-i1-delta-exclude-e2e-from-bun-test`
Base: `main`

Renamed the three e2e files `*.spec.ts` -> `*.e2e.ts` and added
`testMatch: /.*\.e2e\.ts$/` to `apps/web/playwright.config.ts`. Bun has
no `ignore` glob config for `bun test` yet, so extension-based mutual
exclusion is the cleanest split.

**Validated**: after fix, `bun test` reports **123 pass / 0 fail / 304
expect()** in 810ms on the main worktree.

Quarantined (`.skip`): none — fixed at the runner-discovery level
instead.

E2E playwright run was **not** executed 3x — it requires a live Next dev
server on :3001 and apps/api on :3002 (per playwright.config.ts header),
well above the 5-min/run skip threshold.

## Headline

- **Main green? YES.** Typecheck PASS, build PASS, `bun test` clean once
  PR #119 lands. Open PR queue empty. No work blocked.

## File pointers

- Validated against: `/Users/criptopoeta/coding-dojo/defi-web-app/.claude/worktrees/agent-aef79022665157232`
- Fix branch PR: https://github.com/BuFi007/defi-web-app/pull/119
- Local logs: `/tmp/delta-typecheck.log`, `/tmp/delta-build.log`,
  `/tmp/delta-test-2.log`, `/tmp/delta-test-3.log`
