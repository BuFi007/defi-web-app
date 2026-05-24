# Beta Blockers — P0 / P1 / P2 Backlog

Source: Iteration 0 evidence in `docs/loop-12h-prompt.md` plus standing
DOD checklist. Owner-team column maps to the iteration teams (ALPHA /
BRAVO / CHARLIE / DELTA / ECHO / FOXTROT). DOD items refer to the
checklist in `docs/loop-12h-prompt.md`.

Updated: 2026-05-24, Iteration 1.

---

## P0 — must fix before any invite goes out

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P0 | `/en` renders with React root = 0 children. SSR bails out with `BAILOUT_TO_CLIENT_SIDE_RENDERING: next/dynamic` and the client never hydrates. No tester can see the app. | ALPHA.1 | "/en renders Trade Island when wallet connected, NotConnectedHome when not" | IN PROGRESS (Suspense boundary added in apps/web/app/[locale]/layout.tsx on this branch — verify ECHO confirms hydration) |
| P0 | No confirmed hosted production URL referenced by onboarding doc. Beta tester guide assumes `https://fx.bu.finance` — needs verified live deploy + alpha-gate seeded + Arc Testnet contracts pointing right. | DELTA | (implied by all flows) | OPEN |
| P0 | Branch drift: working tree on `feat/wk1n14-privacy-pools-live`, not `main`. Iteration 1 must rebase or land before beta cut. | DELTA.1 | "CI green on main, 3 consecutive runs no flake" | OPEN |
| P0 | Wallet connect on Arc 5042002 via Dynamic has a known flake — first connect sometimes leaves UI in "wallet not connected" state. | CHARLIE.1 | "Wallet connect on Arc Testnet 5042002 via Dynamic — no flake" | OPEN |

## P1 — fix before the demo with invitee 1

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P1 | Runbook claims Trade Island lives on `/` — actually lives on `/en`. `/` does `redirect("/en")`. Onboarding + demo doc must reflect the real path. | FOXTROT.1 / ALPHA.3 | (runbook accuracy) | FIXED (docs/beta-onboarding.md updated) |
| P1 | Alpha gate (`apps/web/app/alpha/alpha-form.tsx:51`) is keyboard-only — Enter advances to step 2 then password input. Brittle for `/browse` automation; not user-facing but blocks ECHO QA. | ALPHA.3 | (test infra) | WORKAROUND DOCUMENTED (POST /api/alpha-gate + `bu_alpha_access=true` cookie) |
| P1 | Tabs sweep — verify Trade / Pools / Privacy / Lend-Borrow / Positions / History all render after ALPHA.1 hydration fix. | ALPHA.2 | "All tabs work: Trade, Pools, Privacy, Lend/Borrow, Positions, History" | OPEN (blocked by P0 above) |
| P1 | Real Morpho yield rates must come from chain (no hardcoded values) on Lend/Borrow tab. | BRAVO.2 | "Real Morpho yield rates show on Lend/Borrow tab (no hardcoded values)" | OPEN (audit pending) |
| P1 | Open + settle + close one perp position end-to-end via `/browse`, evidenced. | ECHO.1 | "Open + settle + close one perp position end-to-end via /browse" | BLOCKED on ALPHA.1 |
| P1 | Privacy deposit + withdraw works on MXNB pool. | ECHO.2 | "Privacy deposit + withdraw works on MXNB pool" | BLOCKED on ALPHA.1 |

## P2 — track but not launch-blocking

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P2 | All on-chain reads route via ponder or direct RPC (no mocks) — audit + remove any remaining mock fixtures. | BRAVO.2 | "All on-chain reads route via ponder or direct RPC (no mocks)" | OPEN |
| P2 | All writes reach a contract (verifiable txhash) — confirm trade / deposit / withdraw / borrow / repay all emit verifiable on-chain txs. | BRAVO.1 | "All writes reach a contract (verifiable txhash)" | OPEN |
| P2 | CI green on main, 3 consecutive runs no flake. | DELTA.3 | "CI green on main, 3 consecutive runs no flake" | OPEN |
| P2 | Asset balances — every market token (USDC, MXNB, QCAD, cirBTC, AUDF, EURC) shows correct chain balance. | CHARLIE.3 | (asset display correctness) | OPEN |
| P2 | Faucet UX — onboarding doc assumes a working in-app faucet link with a "100 USDC + gas drip" path. Confirm it exists; if not, document the manual bridge path. | FOXTROT.1 / DELTA | (onboarding deliverability) | NEEDS VERIFICATION |
| P2 | Operational warning surfacing — known matcher warnings (FillSizeCap, OracleStale, pyth_pusher unresolved) should not be tester-visible. Filter in UI toasts. | ALPHA.2 | (UX polish) | OPEN |

---

## Stretch / Post-beta (do NOT promote — UI is frozen)

These look like new features. Recording so they don't get lost, but
none of them block the beta cut.

- Privacy-note recovery flow (the note is currently single-copy, no
  email backup). Would dramatically reduce lost-fund anxiety but is a
  new feature.
- Mobile Trade Drawer refinements beyond what `trade-drawer.tsx`
  already does.
- In-app bug-report widget (currently we ask testers to drop in Slack).
- Multi-language locale beyond `/en` (Spanish hero exists in copy but
  routing has been collapsed to `/en` for beta scope).
- Cross-chain bridge UX from Sepolia / Base Sepolia into Arc Testnet
  inside the app (today: external faucet).
- Position-level alerts / PnL push notifications.
- Privacy-pool ASP attestation UI (currently silent default-trust).
- Historical chart for privacy pool TVL over time.

---

## Triage rules

- A bug becomes P0 only if it blocks a beta tester from completing
  **any** of the 3 canonical flows.
- A bug is P1 if it blocks the **rehearsed demo** with invitee 1 (see
  `docs/beta-demo-script.md`) but a tester self-serving could still
  recover via the failure-mode escape routes.
- Everything else is P2.
- New-feature requests go to "Stretch / Post-beta" and stay there until
  someone explicitly unfreezes UI scope.
