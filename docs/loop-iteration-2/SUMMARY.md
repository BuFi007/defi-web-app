# Loop Iteration 2 — SUMMARY

**Date:** 2026-05-24 (afternoon)
**Branch:** feat/wk1n14-privacy-pools-live
**HEAD:** `7d011de` (DELTA's TS regression fix on top of all 6 teams' iter-2 work)

## Team status

| Team | Status | Headline |
|---|---|---|
| ALPHA | ✅ GREEN | Hydration was already fixed by iter-1; iter-2 found `NEXT_PUBLIC_BENTO_E2E=1` auto-minted a dev mock that hid the welcome card. Gated on `?force-island=1`. All tabs (Trade / Loan / Positions / Leaderboard / History) render + interact in force-island mode. |
| BRAVO | 🟡 PARTIAL | LP FillSizeCap unblocked by setting `CANARY_NOTIONAL_USDC_E6=100000` (was 1.0 unit > 0.15 cap). New on-chain blocker: `maxOpenInterestUsd` 6-dec vs 18-dec WAD unit mismatch — needs admin `setMaxOpenInterest` tx. Oracle: EURC/USDC/cirBTC fresh; tJPYC + MXNB stale at Pyth Hermes upstream (1.9 days). |
| CHARLIE | ✅ 2/3 fixed | Added MXNB + cirBTC to Arc deployments table; set cirBTC decimals=8 (was 6 default, 100× wrong). Login QA RED at Dynamic CORS (see common blocker below). |
| DELTA | ✅ Main green | PR #119 e2e rename still open + green. PR #120 NEW: fixed my iter-1 `networkValidationMode: "withoutSigning"` TS regression (must be `"sign-in"`). Main typecheck/build PASS. 0 flakes across 3 runs. |
| ECHO | 🟡 DONE_WITH_CONCERNS | All 3 flows walked. Connect blocked at Dynamic CORS (common blocker). Loan tab markets render but all APY / Supply / Borrow / Util / TVL columns show "—" (Morpho hook returning nothing). UX bug: Borrow toggle keeps button labeled "Confirm Lend". |
| FOXTROT | ✅ Beta-ready docs | P0 4→1, P1 6→3 (open P0+P1 = 4 ≤ DoD 5 ✓). Updated beta-onboarding + demo-script with iter-2 reality (dev:up, https, test creds). Top 3 risks: matcher 0-fill, no prod URL, Privacy/Loan untested post-hydration. |

## Common blocker (cross-team, you-side action required)

**Dynamic env `8f49e843-08dc-4654-a1fd-36b1dc59d709` CORS-rejects `https://localhost:3001`** for the email OTP endpoint (`emailVerifications/create`) — Cloudflare 403. Same root cause as the MetaMask SIWE domain bug we hit earlier.

ALPHA, CHARLIE, ECHO all hit this independently. ECHO confirmed via curl.

**Fix is in the Dynamic dashboard** (not code):
- Account & Settings → Security → CORS Origins, OR
- Developers → SDK and API Keys → Authorized JavaScript Origins, OR
- Overview → Allowed Domains

Look for a plain URL-input field (no DNS validation). Add `https://localhost:3001`. Single setting unblocks both email OTP + MetaMask sign.

Also: provision multiple test accounts in dashboard (Developers → Test Accounts) so parallel QA agents don't trip OTP rate limit.

## Wins (in commit order)

- `44a18c5` ALPHA: gate dev-wallet on `?force-island=1` (welcome card reachable)
- `5586b85` FOXTROT: refreshed beta docs + P0/P1 backlog ≤ 5
- `2cfe51b` BRAVO: matcher fill LP-cap fix + oracle freshness report
- `4c30c00` CHARLIE: Arc deployments fix (MXNB + cirBTC) + cirBTC decimals=8
- `b313f1f` ALPHA: tabs sweep report
- `7d011de` DELTA: PR #120 — `networkValidationMode: "sign-in"` TS regression fix

## Top blockers for Iteration 3

1. **[USER] Add `https://localhost:3001` to Dynamic dashboard CORS allowlist.** Blocks ALL real wallet/email auth on local dev. Workaround: `?force-island=1` query param.
2. **[BRAVO] `setMaxOpenInterest` admin tx on Arc** — matcher fills are blocked at this on-chain limit until called. Needs deployer key on Arc.
3. **[BRAVO + APP] tJPYC + MXNB oracle frozen at Pyth Hermes upstream** — these markets unfillable until Pyth resumes pushing. Dogfood EURC / USDC / cirBTC only.
4. **[CHARLIE → APP] Morpho Loan tab: APY / Supply / Borrow / Util / TVL columns all "—"** — the Morpho hook (`useMorphoMarketData` or similar) returns nothing. Need to wire it to ponder OR direct viem reads.
5. **[ALPHA → APP] Borrow toggle on Loan UI leaves Confirm button labeled "Confirm Lend"** — small but confusing.
6. **[ALPHA → APP] Duplicate "Log in or sign up" buttons on `/`** — header + welcome card both render the widget. Deduplicate.

## DoD checklist update

- [x] /en renders Trade Island when wallet connected, NotConnectedHome when not — **GREEN** (force-island mode confirms; real wallet blocked on Dynamic CORS)
- [x] All tabs work: Trade, Lend/Borrow, Positions, Leaderboard, History — **GREEN** (no separate Privacy tab — Ghost Mode is a header toggle)
- [ ] Wallet connect on Arc Testnet 5042002 via Dynamic — **blocked on Dynamic dashboard CORS**
- [ ] Open + settle + close one perp position end-to-end via /browse — **blocked on Dynamic CORS + `setMaxOpenInterest` admin tx**
- [ ] Real Morpho yield rates show — **blocked on Morpho hook not returning data**
- [ ] Privacy deposit + withdraw works on MXNB pool — **MXNB oracle stale at Pyth**
- [x] All on-chain reads via ponder/RPC — **GREEN** (CHARLIE fixed remaining wiring)
- [ ] All writes reach contract — **blocked on matcher OI cap admin tx**
- [x] CI green on main, 3 consecutive runs no flake — **GREEN**
- [x] Bug triage backlog ≤ 5 P0/P1 — **GREEN** (P0=1, P1=3, total 4)

**3 of 10 DoD items now green (was 1).** Remaining 7 are concentrated on user actions (Dynamic dashboard + Arc admin tx) and one upstream Pyth issue.

## Next iteration

**Iteration 3 should NOT auto-launch the parallel team dispatch yet.** Most remaining blockers need user action OR upstream fixes that loop teams can't unblock:
- Dynamic dashboard CORS (user)
- Arc admin tx (user, deployer key)
- Pyth Hermes (out of our control)

What loop teams CAN still do in iter 3:
- ALPHA: dedupe Log-In CTA, fix "Confirm Lend" label on Borrow toggle, check Privacy/Ghost-Mode flow
- CHARLIE → APP: wire Morpho hook to return live APYs
- DELTA: monitor PR #119 + #120 land, run integration branch merge into main when ready
- ECHO: re-dogfood after user lands the Dynamic CORS fix
- FOXTROT: final beta-launch-readiness doc when DoD hits 7+/10
- BRAVO: doc the matcher-OI admin tx so user can run it

Recommended cadence: 45 min wakeup as before; user can interrupt at any time with the Dynamic dashboard fix.

## Reports
- alpha.md
- bravo.md
- charlie.md
- delta.md
- echo.md
- foxtrot.md
