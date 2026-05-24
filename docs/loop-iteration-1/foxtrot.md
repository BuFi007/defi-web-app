# Team FOXTROT — Iteration 1

## FOXTROT.1 — Onboarding doc
- File: docs/beta-onboarding.md
- Status: DRAFT
- Open blockers (e.g. no hosted URL):
  - Need confirmation `https://fx.bu.finance` is live, alpha-gate-seeded,
    pointing at Arc Testnet 5042002 contracts (URL inferred from
    `apps/web/scripts/sync-dynamic-webhooks.mjs`). If not live, this doc
    is unsendable.
  - Need confirmation the in-app **faucet** link actually exists and
    drips 100 USDC + gas + MXNB in ≤30s, or doc must be rewritten with
    a manual bridge path.
  - Doc assumes Privacy tab + Lend/Borrow tab actually render — depends
    on ALPHA.1 Suspense fix landing (already in working tree on this
    branch). Verify after ECHO confirms hydration end-to-end.
  - Bug-report channel name `#bufi-beta` is a placeholder — confirm
    actual Slack channel + on-call handle before send.

## FOXTROT.2 — Demo script
- File: docs/beta-demo-script.md
- Status: DRAFT
- Notes: 12-minute rehearsed walkthrough covering alpha gate → wallet
  connect → EUR/USD perp open+close → MXNB privacy deposit → Morpho
  USDC→MXNB borrow+repay. Screenshot placeholders inline. Failure-mode
  escape table at bottom for operator. Privacy withdraw deliberately
  cut to keep under 12 min — flagged in script.

## FOXTROT.3 — Bug triage
- File: docs/beta-blockers.md
- Counts: P0=4, P1=6, P2=6, Post-beta=8
- Seeded with all four Iteration 0 findings from docs/loop-12h-prompt.md
  (SSR bailout, runbook `/` vs `/en`, alpha-gate keyboard-only,
  branch drift) plus the standing DOD checklist mapped to owner teams.
- Noted ALPHA.1 Suspense fix already in this branch's working tree
  (apps/web/app/[locale]/layout.tsx) — status flipped to IN PROGRESS
  pending ECHO verification.

## Top 3 risks to beta launch
- 1. **App doesn't render until ALPHA.1 ships.** Suspense fix is on
     this branch but unverified by ECHO. Until ECHO confirms hydration
     end-to-end on `/en`, every downstream flow in onboarding + demo is
     theoretical.
- 2. **No verified hosted production URL.** Onboarding + demo both
     assume `https://fx.bu.finance` is live, alpha-gated, and pointing
     at Arc Testnet. If it's not, beta invites have nowhere to land.
     DELTA owns this; needs explicit confirmation before invites go out.
- 3. **Wallet connect flake on Arc 5042002 via Dynamic.** Even with
     render fixed, first-time tester experience starts with "Log in or
     sign up". A flaky first-contact is a permanent first-impression
     loss. CHARLIE.1 must reproduce and harden before any invitee 1
     session.
