# Team FOXTROT — Iteration 2

Branch: `feat/wk1n14-privacy-pools-live` @ d7dc2ba (pre-commit).
Inputs: iter-1 docset, iter-1 SUMMARY, iter-1 alpha/bravo/charlie/echo/
delta reports, iter-2 ECHO screenshots `/tmp/echo-i2-{01,02,03}.png`.

## FOXTROT.1 — Docs updated

- **onboarding** (`docs/beta-onboarding.md`):
  - Added operator local-dev callout: `bun run dev:up` (was
    `dev:complete`), web on `https://localhost:3001` under mkcert
    self-signed (run `mkcert -install` once); API dev CORS now allows
    that origin.
  - Rewrote Step 2 ("Connect your wallet") to point at the **visible
    welcome-card CTA** (was: "hamburger top-right").
  - Added Dynamic test-login fallback (`+dynamic_test@` email + OTP
    `967140` from `tests/fixtures/dynamic-test-accounts.json`) for
    local-dev wallet flake.
- **demo script** (`docs/beta-demo-script.md`):
  - Pre-call checklist: swapped HTTP `/health` for `grpcurl -plaintext
    127.0.0.1:3005 grpc.health.v1.Health/Check` (no HTTP `/health` on
    this branch — only gRPC :3005).
  - Flow 0 + Flow 1: replaced 3 screenshot placeholders with real
    `/tmp/echo-i2-*.png` paths; flagged the iter-2 commit `d12e813`
    that made the Log-In CTA visible.
  - Flow 1: added the Dynamic test-email + OTP `967140` fallback path
    plus a note on the dev-environment "too many requests" Dynamic
    banner that occasionally appears.
  - Operator failure-mode table: order-pending check → gRPC; wallet
    won't connect → Dynamic test login fallback.
- **commit:** to be pushed at end of this run (see commit line below).

## FOXTROT.2 — Real screenshots wired

- count linked: **3** (placeholders eliminated for Flow 0 + Flow 1).
  - `/tmp/echo-i2-01-home.png` — Trade Island after login (chart +
    Spot Order panel + Log-In CTA top-right).
  - `/tmp/echo-i2-02-modal.png` — Dynamic modal open over welcome
    card showing MetaMask / Coinbase / WalletConnect / 600+ wallets /
    email / GitHub / Google.
  - `/tmp/echo-i2-03-otp.png` — Dynamic modal with test email
    pre-filled at OTP step (also shows the dev "too many requests"
    banner — flagged in script).
- Flows 2–4 still have inline placeholders — those screens require
  on-chain interactions ECHO has not yet captured this iteration.
  Will refresh in iter 3 once ECHO + CHARLIE drop more `/tmp/*-i2-*.png`.

## FOXTROT.3 — Triage refresh

- **P0 before: 4 / after: 1**
- **P1 before: 6 / after: 3**
- **Open P0+P1 total: 10 → 4 — clears the DoD ceiling of ≤ 5.**
- ✅ Fixed in iter 1–2 (7 items, moved to "Fixed" section with
  resolving commits):
  1. `/en` BAILOUT_TO_CSR / hydration dead → `f8d51ef` + `47f7286`
  2. NotConnectedHome missing Log-In CTA → `d12e813`
  3. Dynamic eth_accounts revoke loop on login → `7d96a98` + `ce316b8`
  4. RPC / ad-blocker CORS noise drowning real errors → `9e41366`
  5. `bun run dev:complete` plaintext local stack → `ef790fd` +
     `d7dc2ba` (dev:up HTTPS + CORS allow-list)
  6. ECHO QA blocked on MetaMask flake → `d7dc2ba` (Dynamic test accts
     fixture)
  7. Runbook `/` vs `/en` → iter-1 docs commit `6ebbc38`
- Surviving P0 (1): no verified hosted production URL (DELTA).
- Surviving P1 (3): matcher 0-fill loop (BRAVO.2); full tabs sweep
  re-verification post-hydration (ALPHA.2 / ECHO); real Morpho yields
  audit (BRAVO.2).
- Downgraded to P2: branch drift (intentionally landing on
  `feat/wk1n14-privacy-pools-live`); privacy + lend/borrow ECHO re-runs
  (unblocked by hydration but not yet tester-facing); the 3 CHARLIE
  iter-1 wiring bugs (deployments table + cirBTC decimals + Arc native
  USDC decimals — display-correctness, not flow blockers).
- Added to Post-beta: HTTP `/health` matcher endpoint (operators
  script gRPC; new-feature surface, not a beta blocker); global
  wrong-chain banner.

## Top 3 risks to beta launch (post iter 2)

1. **Matcher still produces 0 fills end-to-end.** Hydration is back, UI
   reaches the order panel, signatures land — but BRAVO iter-1 showed
   13.9h of 0 fills with 51 pending intents. Until a single perp
   round-trip (open + settle + close) is on-chain-verified, the
   headline "trade on Arc" promise is theoretical. Highest-impact
   blocker remaining.
2. **Hosted production URL unconfirmed.** Both onboarding and demo
   doc assume `https://fx.bu.finance` is live, alpha-gated, and
   pointing at Arc Testnet 5042002 contracts. DELTA owns this; without
   explicit confirmation, invites have nowhere to land.
3. **Tabs sweep beyond Trade is unverified post-hydration.** ECHO iter-2
   confirmed Trade/Leaderboard/Positions render, but Privacy and
   Lend/Borrow haven't been re-exercised since the SSR fix landed. If
   either tab silently regressed, two of the three canonical onboarding
   flows go dark on first contact.
