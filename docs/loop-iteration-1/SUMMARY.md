# Loop Iteration 1 — SUMMARY

**Date:** 2026-05-24
**Branch:** feat/wk1n14-privacy-pools-live
**Driver commit:** 47f7286 (fix(render): disable cacheComponents + drop mounted gate)

## Team status

| Team | Status | Headline |
|---|---|---|
| ALPHA | PARTIAL → RED | SSR render fixed (welcome card visible), but React never hydrates — DOM has 0 reactFiber keys. Buttons inert. |
| BRAVO | RED | gRPC + sig verify + persist all OK; matcher tick loop produces 0 fills across 13.9h uptime. 3 candidate causes identified. Found ghost FxOracle address. |
| CHARLIE | 3 confirmed bugs | UI deployments missing MXNB/QCAD/cirBTC on Arc; cirBTC decimals fallback wrong (=6 vs actual 8); ArcTestnet.nativeCurrency.decimals=18 wrong. |
| DELTA | GREEN | Main typecheck + build pass. 0 open PRs at start. Shipped PR #119 (rename *.spec.ts → *.e2e.ts to stop bun test from running Playwright). |
| ECHO | DEGRADED | Welcome card SSRs but hydration broken → buttons inert. NotConnectedHome has no Log-In CTA (only header hamburger, which also dead). Privacy + Loan inspection blocked. |
| FOXTROT | DELIVERABLES SHIPPED | docs/beta-onboarding.md + beta-demo-script.md + beta-blockers.md (P0=4, P1=6, P2=6, Post-beta=8). |

## Top blocker for Iteration 2

**React hydration failing on `/`** — page SSRs the welcome card + Dynamic SDK styles but client never attaches. ECHO confirmed 0 reactFiber keys on the DOM tree. Without this, ECHO can't dogfood, CHARLIE can't visually test wallet connect, and BRAVO's matcher fixes can't be exercised end-to-end.

**Candidate causes for Iteration 2 ALPHA:**
1. Client bundle crashes early — check /tmp/echo-i1-*.png console output and explicitly run `$B console --errors`
2. Server-streamed content too large + Suspense fallback null hides the actual error
3. NotConnectedHome's missing CTA + dead hamburger may be a hydration-cascade symptom — fix one and the rest may follow

## Top blockers for Iteration 2 (others)

3. **Matcher fills broken** (BRAVO): orderbook tick loop produces 0 fills. Candidate: intent_translator.rs:282 hardcodes GTC, dropping wire tif. MARKET orders with priceE18=0 may not cross.
4. **NotConnectedHome no Log-In CTA** (ALPHA → UI bug): user must guess the hamburger. Add a "Log in or sign up" button to the welcome card.
5. **Arc deployments table missing MXNB/QCAD/cirBTC** (CHARLIE → BRAVO): packages/location/src/deployments.ts:63-67. Wire from @bufi/contracts.
6. **cirBTC decimals** (CHARLIE): on-chain = 8, UI fallback = 6. 100× display error if MXNB/CIRBTC ever wired.

## DoD checklist update

- [ ] /en renders Trade Island when wallet connected, NotConnectedHome when not — **partial** (NotConnectedHome renders SSR, hydration broken)
- [ ] All tabs work — **blocked** (no nav available without hydration)
- [ ] Wallet connect on Arc Testnet 5042002 — **blocked** (Log-In CTA missing + buttons inert)
- [ ] Open + settle + close one perp position end-to-end — **blocked** (matcher fills broken + no UI access)
- [ ] Real Morpho yield rates show — **not assessed**
- [ ] Privacy deposit + withdraw works on MXNB pool — **blocked**
- [ ] All on-chain reads via ponder/RPC — **partial** (CHARLIE found 3 bugs in deployments wiring)
- [ ] All writes reach contract — **blocked** (BRAVO matcher RED)
- [x] CI green on main, 3 consecutive runs no flake — **GREEN** (DELTA + PR #119)
- [ ] Bug triage backlog ≤ 5 P0/P1 — currently P0=4, P1=6 per FOXTROT

## Wins
- ALPHA + driver fixed SSR render (eliminated BAILOUT_TO_CSR + welcome card visible)
- DELTA: main green, PR #119 in
- BRAVO: identified ghost FxOracle address (was 0xF9D0…aFf03, real is 0x77b3…2865)
- FOXTROT: full beta-launch docset shipped
- CHARLIE: 3 high-precision actionable bugs

## Next iteration

Iteration 2 priority: **fix React hydration on `/`**, then unblock ECHO to dogfood for real.

Reports:
- alpha.md
- bravo.md
- charlie.md
- delta.md
- echo.md
- foxtrot.md
