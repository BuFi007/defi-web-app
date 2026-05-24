# Beta Blockers — P0 / P1 / P2 Backlog

Source: Iteration 0 evidence in `docs/loop-12h-prompt.md` plus
iteration 1 reports under `docs/loop-iteration-1/`, plus iteration 2
in-flight signal (ECHO screenshots `/tmp/echo-i2-01..03.png` confirming
the welcome card, Dynamic modal, and OTP step all render and interact).

Updated: 2026-05-24, Iteration 2 (FOXTROT triage refresh).

DoD target: **≤ 5 open P0/P1 items**. Iter 1 was at P0=4 + P1=6 = 10.
This refresh moves us to **P0=1 + P1=3 = 4**.

---

## ✅ Fixed in iter 1 → iter 2

| issue | resolving commit | evidence |
|---|---|---|
| `/en` BAILOUT_TO_CLIENT_SIDE_RENDERING — page never hydrated, all buttons inert | `f8d51ef` (defer wallet providers to client mount) + `47f7286` (disable cacheComponents + drop mounted gate) | ECHO iter-2 `/tmp/echo-i2-01-home.png` shows Trade Island chart and order panel rendered; `/tmp/echo-i2-02-modal.png` shows Dynamic modal opening on click → hydration is alive |
| NotConnectedHome has no Log-In CTA — user had to guess the hamburger | `d12e813` (add Log-In CTA to NotConnectedHome welcome card) | Header **Log in or sign up** button visible top-right in `/tmp/echo-i2-01-home.png`; demo script updated |
| Dynamic connect flake — eth_accounts revoke loop on login | `7d96a98` (stop the eth_accounts revoke loop) + `ce316b8` (useMetamaskSdk:false bypass @metamask/sdk wrapping) | ECHO iter-2 modal opens and OTP step reached without loop (`/tmp/echo-i2-03-otp.png`) |
| RPC CORS / ad-blocker noise drowning real client errors | `9e41366` (pin explicit transports) | ECHO iter-2 modal interactions no longer drowned in CORS noise |
| Local dev required `bun run dev:complete` + plaintext localhost:3001 (broke wallet flows that demand secure context) | `ef790fd` (`bun run dev:up` HTTPS quiet stack, logs to files) + `d7dc2ba` (API CORS allow https://localhost:3001) | Stack now boots on `https://localhost:3001` with mkcert; CORS allow-list updated |
| ECHO QA blocked on MetaMask flake while dogfooding wallet flows | `d7dc2ba` (save Dynamic test accts at `tests/fixtures/dynamic-test-accounts.json`) | Test creds (`+dynamic_test@` email + OTP `967140`) wired into onboarding + demo doc |
| Runbook claimed Trade Island lives on `/` — actually `/en` | docs commit `6ebbc38` (iter 1 FOXTROT) | Onboarding + demo doc both reference `/en` |

---

## P0 — must fix before any invite goes out

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P0 | No confirmed hosted production URL referenced by onboarding doc. Beta tester guide assumes `https://fx.bu.finance` — needs verified live deploy + alpha-gate seeded + Arc Testnet contracts pointing right. | DELTA | (implied by all flows) | OPEN |

> Branch drift (was P0 in iter 1) is **downgraded to P2** — the iter 1/2
> fixes were intentionally landed on `feat/wk1n14-privacy-pools-live`
> because that's where the privacy-pool surface and hydration fixes
> live. Rebase/merge to `main` is a DELTA pre-cut task, not a tester-
> facing blocker.

## P1 — fix before the demo with invitee 1

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P1 | Matcher tick loop produces 0 fills across 13.9h uptime (BRAVO iter-1 finding). End-to-end "open + settle + close one perp position" still RED. Candidate causes: `intent_translator.rs:282` hardcodes GTC dropping wire tif; MARKET orders with priceE18=0 may not cross. | BRAVO.2 / ECHO.1 | "Open + settle + close one perp position end-to-end via /browse" | OPEN |
| P1 | Tabs sweep — verify Trade / Pools / Privacy / Lend-Borrow / Positions / History all render now that hydration is restored (iter 1 had this blocked on the SSR bailout). | ALPHA.2 / ECHO | "All tabs work" | NEEDS VERIFICATION (iter-2 ECHO confirmed Trade + Leaderboard + Positions tabs render in `/tmp/echo-i2-01-home.png`; Privacy + Lend/Borrow still to confirm) |
| P1 | Real Morpho yield rates must come from chain (no hardcoded values) on Lend/Borrow tab. | BRAVO.2 | "Real Morpho yield rates show on Lend/Borrow tab (no hardcoded values)" | OPEN (audit pending) |

## P2 — track but not launch-blocking

| priority | issue | owner_team | blocking_dod_item | status |
|---|---|---|---|---|
| P2 | Branch drift: working tree on `feat/wk1n14-privacy-pools-live`. Rebase / merge before beta cut. | DELTA.1 | "CI green on main, 3 consecutive runs no flake" | OPEN |
| P2 | Privacy deposit + withdraw works on MXNB pool — unblocked by hydration fix; needs ECHO confirmation. | ECHO.2 | "Privacy deposit + withdraw works on MXNB pool" | OPEN (NEEDS RE-RUN now that hydration works) |
| P2 | Arc deployments table missing MXNB/QCAD/cirBTC (CHARLIE iter-1 finding in `packages/location/src/deployments.ts:63-67`). Wallet popover will show "Pending" for 3 of 6 stables until wired. | BRAVO (consumer of CHARLIE.3) | (asset display correctness) | OPEN |
| P2 | `cirBTC` decimals fallback wrong: on-chain = 8, UI fallback = 6 → 100× display error when MXNB/CIRBTC ever wired in. | CHARLIE.3 → BRAVO | (asset display correctness) | OPEN |
| P2 | `ArcTestnet.nativeCurrency.decimals = 18` in `apps/web/constants/Chains.ts:269` — Arc native USDC is **6dp**. Wrong "Add Network" payload to MetaMask. | CHARLIE.2 | (chain config correctness) | OPEN |
| P2 | All on-chain reads route via ponder or direct RPC (no mocks) — audit + remove any remaining mock fixtures. | BRAVO.2 | "All on-chain reads route via ponder or direct RPC (no mocks)" | OPEN |
| P2 | All writes reach a contract (verifiable txhash) — confirm trade / deposit / withdraw / borrow / repay all emit verifiable on-chain txs. | BRAVO.1 | "All writes reach a contract (verifiable txhash)" | OPEN (gated on matcher P1 above) |
| P2 | Asset balances — every market token (USDC, MXNB, QCAD, cirBTC, AUDF, EURC) shows correct chain balance. | CHARLIE.3 | (asset display correctness) | OPEN |
| P2 | Faucet UX — onboarding doc assumes a working in-app faucet link with a "100 USDC + gas drip" path. Confirm it exists; if not, document the manual bridge path. | FOXTROT.1 / DELTA | (onboarding deliverability) | NEEDS VERIFICATION |
| P2 | Operational warning surfacing — known matcher warnings (FillSizeCap, OracleStale, pyth_pusher unresolved) should not be tester-visible. Filter in UI toasts. | ALPHA.2 | (UX polish) | OPEN |
| P2 | Webpack HMR handshake fails every ~5s on dev (`ws://127.0.0.1:3001/_next/webpack-hmr → ERR_INVALID_HTTP_RESPONSE`, ECHO iter-1). Cosmetic but spammy; may mask Fast Refresh. | ALPHA | (dev DX) | OPEN |
| P2 | Sentry + React-Grab + Next devtools all load on the alpha-gated page (ECHO iter-1). Heavy bundle on a public welcome card; verify they're dev-only before invite send. | ALPHA / DELTA | (security + perf) | OPEN |
| P2 | Alpha gate keyboard-only — Enter advances to step 2 then password. Brittle for `/browse` automation. | ALPHA.3 | (test infra) | WORKAROUND DOCUMENTED (POST /api/alpha-gate + `bu_alpha_access=true` cookie) |

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
- Global "wrong chain" banner / auto-switch guard (CHARLIE iter-1
  yellow flag — Dynamic widget is wired, just no global guard).
- HTTP `/health` endpoint on matcher (currently only gRPC :3005). New
  feature, not a beta blocker — operators script grpcurl.

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
