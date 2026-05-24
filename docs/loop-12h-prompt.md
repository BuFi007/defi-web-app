# Beta-Readiness /loop — 6 Teams, 45-Min Cadence

Goal: ship defi-web-app + fx-telarana to **100% working state** for beta invites. **No new features.** Beautiful UI stays as is. Make it work perfectly against wallet + smart contracts + assets.

Copy the block between the fences into Claude Code to launch.

---

## Iteration 0 evidence (already captured — feeds Team ALPHA on first dispatch)

- Branch drift: working tree on `feat/wk1n14-privacy-pools-live`, not `main`. Iteration 1 must rebase or land.
- `/` → `redirect("/en")` in `apps/web/app/page.tsx:49`. Runbook claims Trade Island lives on `/` — wrong. Lives on `/en`.
- `/en` renders with **React root = 0 children**. SSR errors with `BAILOUT_TO_CLIENT_SIDE_RENDERING: next/dynamic`, CSR never hydrates. Trade Island css chunk preloaded but never used.
- `apps/web/components/home/index.tsx:43` gates on `useBufiIsConnected()` — never reached because nothing mounts.
- Alpha gate at `apps/web/app/alpha/alpha-form.tsx:51` is keyboard-only (Enter → step 2 → password input). `/browse press Enter` does not reliably trigger. Use direct `POST /api/alpha-gate` + `bu_alpha_access=true` cookie for automation.
- Matcher healthy: `:3005` gRPC, `:3006` HTTP `/health` returns `{ok, ready:true, tick:true}`.
- API healthy: `:3002/health` returns `{ok:true}`.
- Web is on `:3001` (next-server v16.2.6 dev). HMR WebSocket fails — dev-mode noise, ignore.

---

```
/loop

MISSION: defi-web-app + fx-telarana → 100% beta-ready in continuous 45-min iterations. NO new features. UI design is frozen. Make it work against wallet, smart contracts, and assets.

DEFINITION OF DONE (binary, evidence-required per item)
□ /en renders Trade Island when wallet connected, NotConnectedHome when not
□ All tabs work: Trade, Pools, Privacy, Lend/Borrow, Positions, History
□ Wallet connect on Arc Testnet 5042002 via Dynamic — no flake
□ Open + settle + close one perp position end-to-end via /browse
□ Real Morpho yield rates show on Lend/Borrow tab (no hardcoded values)
□ Privacy deposit + withdraw works on MXNB pool
□ All on-chain reads route via ponder or direct RPC (no mocks)
□ All writes reach a contract (verifiable txhash)
□ CI green on main, 3 consecutive runs no flake
□ Bug triage backlog ≤ 5 P0/P1 items

TEAM STRUCTURE — six teams, each dispatched in PARALLEL each iteration via Agent tool, single message, multiple tool calls.

═══════════════════════════════════════════════════════════════
TEAM ALPHA — Frontend Render
subagent_type: general-purpose
═══════════════════════════════════════════════════════════════
Subteams (own Agent invocations within team's run):
  • ALPHA.1 Hydration Fixer — diagnose & fix SSR bailout in apps/web/components/home/index.tsx; verify HomeContent + Suspense fallback render
  • ALPHA.2 Tab QA — sweep every tab (Trade / Pools / Privacy / Lend-Borrow / Positions / History), report which render and which don't
  • ALPHA.3 Locale routing — confirm /en is canonical, fix `/ → /en` infinite redirect risk if any; update runbook
Pass to: ECHO (dogfood verifies fix)

═══════════════════════════════════════════════════════════════
TEAM BRAVO — Contracts ↔ Backend Sync
subagent_type: general-purpose
═══════════════════════════════════════════════════════════════
Subteams:
  • BRAVO.1 Matcher live-fire — submit synthetic SignedOrder, observe settleMatch on Arc, confirm Redis bufi:trades fires
  • BRAVO.2 ContractCall audit — grep apps/web for hardcoded prices/balances/APYs; replace each with viem read or ponder query
  • BRAVO.3 Oracle health — verify FxOracle 0xF9D0442D29933067E45C590244258C01D00aFf03 returns fresh marks for all 5 markets (MXNB/QCAD/cirBTC/AUDF/EURC)
Pass to: ALPHA (UI must consume real data)

═══════════════════════════════════════════════════════════════
TEAM CHARLIE — Wallet & Asset Flow
subagent_type: general-purpose
═══════════════════════════════════════════════════════════════
Subteams:
  • CHARLIE.1 Dynamic connect — drive Log-in via /browse, verify wallet detects + auto-switches network
  • CHARLIE.2 Network switcher — confirm Arc 5042002 add-to-wallet works on cold MetaMask
  • CHARLIE.3 Asset balances — every market token shows correct balance from chain (USDC, MXNB, QCAD, cirBTC, AUDF, EURC)
Pass to: BRAVO (debug bridge between UI and chain)

═══════════════════════════════════════════════════════════════
TEAM DELTA — CI/CD Babysitter
subagent_type: vercel:deployment-expert
═══════════════════════════════════════════════════════════════
Subteams:
  • DELTA.1 PR auto-merge — gh pr list, for each green PR enable auto-merge; for each red PR push fix commit (root-cause, never --no-verify)
  • DELTA.2 Type/build fixer — bun typecheck && bun build on main; patch any breakage incl. utils/svgs.tsx JSX intrinsics
  • DELTA.3 Test stability — run e2e 3x, identify flakes, quarantine or fix
Pass to: nothing (Delta is terminal — main green is the deliverable)

═══════════════════════════════════════════════════════════════
TEAM ECHO — Dogfood QA (via /browse)
subagent_type: general-purpose
MUST invoke /browse skill. NEVER use mcp__claude-in-chrome__*.
═══════════════════════════════════════════════════════════════
Subteams:
  • ECHO.1 Trade flow — follow docs/dogfood-2026-05-24.md §4 as skeptical first-time trader; open + settle + close EUR/USD perp; capture every blocker
  • ECHO.2 Privacy flow — dark-mode deposit + withdraw on MXNB pool; verify proof gen + on-chain settle + no address leaks
  • ECHO.3 Loan flow — open USDC-collateral / MXNB-loan position on Morpho; verify rate displays + borrow + repay
Write findings to docs/loop-iteration-{N}/echo.md
Top 3 UX bugs + top 3 functional bugs ranked by severity
Pass to: ALPHA (UI bugs), BRAVO (contract bugs), CHARLIE (wallet bugs)

═══════════════════════════════════════════════════════════════
TEAM FOXTROT — Beta Readiness
subagent_type: general-purpose
═══════════════════════════════════════════════════════════════
Subteams:
  • FOXTROT.1 Onboarding doc — update docs/dogfood-2026-05-24.md so an outside beta tester can self-serve from clean clone to first trade
  • FOXTROT.2 Demo script — record a "happy path" rehearsal (steps, expected output) for invitee 1
  • FOXTROT.3 Bug triage board — read docs/loop-iteration-{N-1}/* outputs; produce P0/P1/P2 backlog table in docs/beta-blockers.md
Pass to: nothing (Foxtrot owns release readiness)

═══════════════════════════════════════════════════════════════
EACH ITERATION (you, the loop driver)
═══════════════════════════════════════════════════════════════
1. mkdir -p docs/loop-iteration-{N}
2. Spawn all SIX teams in PARALLEL (single message, six Agent tool calls)
3. Wait for all six (do not poll — Agent tool blocks)
4. Read all six reports, write docs/loop-iteration-{N}/SUMMARY.md
5. Pick top blocker, fix yourself (or dispatch a fix-agent if non-trivial)
6. Commit + push to main (or open PR if main is protected)
7. Update docs/loop-state.json with {iteration:N+1, dod_progress:{}, blockers:[], next_action:"..."}
8. ScheduleWakeup delaySeconds=2700 (45 min), prompt: re-invoke /loop with same brief

═══════════════════════════════════════════════════════════════
STOP CONDITIONS
═══════════════════════════════════════════════════════════════
• All DOD checkboxes evidenced → produce docs/beta-launch-readiness.md, STOP
• User sends any message → yield immediately
• 16 iterations elapsed (~12h) with no DOD progress → escalate to user

═══════════════════════════════════════════════════════════════
NON-NEGOTIABLES
═══════════════════════════════════════════════════════════════
• NO new features. Only fix what's broken.
• UI design frozen — fix functionality, not aesthetics.
• Never --no-verify, never force-push to main, never bypass hooks
• Never print private keys (always $VAR_NAME)
• Never use mcp__claude-in-chrome__* — use /browse
• 3 distinct EOAs for matcher (PERP_KEEPER, LP_OPERATOR, CANARY_TRADER)
• Asset rules: tCHFC/CHFC removed; tJPYC keeps prefix; MXNB drops prefix; AUDF at 0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b
• Iteration 0 evidence is in docs/loop-12h-prompt.md preamble — feed to ALPHA.1 first

═══════════════════════════════════════════════════════════════
ITERATION 1 — START NOW
═══════════════════════════════════════════════════════════════
First task: ALPHA.1 fixes the React render. Without it, ECHO can't dogfood. Block ECHO until ALPHA.1 reports green, then unblock everyone.
```

---

## How to launch

```bash
cd /Users/criptopoeta/coding-dojo/defi-web-app
# matcher should be running locally per docs/dogfood-2026-05-24.md
# paste the /loop block above into Claude Code
```

## How to stop early

Send any message. /loop yields on user input.

## How to monitor

```bash
# State file is the source of truth between iterations
cat docs/loop-state.json | jq .

# Per-iteration reports
ls docs/loop-iteration-*/

# Beta blockers backlog
cat docs/beta-blockers.md
```
