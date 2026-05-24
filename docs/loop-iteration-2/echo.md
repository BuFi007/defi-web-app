# Team ECHO — Iteration 2

Branch: `feat/wk1n14-privacy-pools-live` @ d7dc2ba. Viewport 1440x900. HTTPS https://localhost:3001. Logged in via headless via shadow DOM (Dynamic modal lives in shadow root, regular @e refs miss the submit arrow).

## ECHO.1 — Trade flow
- Welcome card -> modal -> email -> OTP -> Trade Island
  - Home loads with Trade Island shell already rendered pre-connect (hydration fixed by ALPHA; no SSR break). Screenshot: `/tmp/echo-i2-01-home.png`.
  - "Log in or sign up" CTA visible top-right. Click opens Dynamic modal. Screenshot: `/tmp/echo-i2-02-modal.png`.
  - Email input lives inside Dynamic's shadow DOM; `$B fill @eN` works but submit arrow is NOT in the a11y tree (no aria-label, type=submit only). Resolved by walking shadow roots in JS and calling `.click()` on `button[type=submit]`.
  - Email POST to `https://app.dynamicauth.com/.../emailVerifications/create` hangs `pending` indefinitely. Direct curl returns **HTTP 403 from Cloudflare** ("Attention Required"). Dynamic UI surfaces this as "Request failed. You may be sending too many requests". Same behavior after 90s cooldown -> not a real rate limit, Cloudflare bot-protect is blocking the Dynamic tenant from local origin.
  - Phone path NOT exposed in modal (only Email + GitHub + Google). Can't fall back.
- Connect success: **NO** — blocked at Dynamic OTP step, Cloudflare 403 on `emailVerifications/create` from this origin/IP.
- Order submit path: walks to wallet-gate correctly. Buy/Sell are `[disabled]` until wallet connects. Spot Limit + Market + Stop + TP/SL all selectable, leverage rail (2x-100x) clickable, amount input accepts values, % buttons work. Could NOT submit to API because Buy/Sell stay disabled without a connected wallet. Screenshot: `/tmp/echo-i2-12-order.png`.
- Screenshots: `/tmp/echo-i2-{01-home,02-modal,03-otp,03b-retry,03c,03d,04-trade-island,07-island,12-order}.png`.

## ECHO.2 — Privacy flow
- No "Privacy" / "Telarana" tab in the post-`force-island=1` nav. Tabs surfaced: Loan/Borrow, Trade, Positions, Leaderboard, History. `/privacy` route returns 404.
- Pools visible: **none reachable from UI**.
- Deposit flow reach: **blocked — no entry point in nav**. Privacy island either lives behind connect (which is broken) or is wired only in a different route I cannot find.

## ECHO.3 — Loan flow
- Markets visible (via `force-island=1` Loan/Borrow tab):
  - **Fuji Hub**: EURC/USDC, USDC/EURC, MXNB/USDC, USDC/MXNB (all 86% LLTV, market addr `0x7ba7...cF0a`)
  - **Arc Hub**: EURC/USDC, USDC/EURC, AUDF/USDC, USDC/AUDF (all 86% LLTV, addr `0x8132...1464`), plus **cirBTC/USDC** (LLTV shown as "—", no addr)
- APYs displayed (non-placeholder?):

| col          | value |
|--------------|-------|
| Supply       | —     |
| Borrow       | —     |
| Util         | —     |
| TVL          | —     |
| YOU WILL EARN| $0.00 / yr / mo / day |
| APY badge    | —     |

All numeric columns and the earnings projection are em-dashes / zeros. The 86% LLTV chip is hardcoded per market, not pulled from Morpho.
- Borrow flow reach: walks to amount-entry + Confirm-disabled gate. Picked MXNB/USDC, entered `1`, clicked Borrow action toggle. UX bug: action toggle visually highlights "Borrow" but the confirm button label still reads **"Confirm Lend"** (action-mode state not propagated to CTA). Confirm is disabled (needs wallet). Screenshot: `/tmp/echo-i2-11-borrow-amount.png`.

## Top 3 UX bugs (severity ranked)
1. **Dynamic email-OTP is hard-blocked by Cloudflare 403 on this origin** (sev: critical, blocker for ALL flows that require connect). Affects every dogfooder who isn't on a whitelisted IP. Test creds are useless if the API never returns.
2. **Two stacked "Log in or sign up" buttons render on `/`** (sev: high). Snapshot shows `@e6` and `@e7` both with the exact same label. Probably one is the welcome-card CTA and one is the top-nav, both visible at the same time.
3. **Loan panel CTA label desynced from action mode** (sev: medium). Toggling Borrow leaves "Confirm Lend" visible, then it's unclear whether confirming would borrow or lend.

## Top 3 functional bugs
1. **Loan market APY / Supply / Borrow / Util / TVL all show "—"** (sev: critical for demo). Morpho hook not returning data, or `useMarkets` is wired to a stub. Charlie/Bravo should check `useMorphoMarkets` / RPC fetch.
2. **`/privacy` route is 404 and no nav entry exists for it** (sev: critical for demo of privacy pools). Either the route file is missing or the nav-tab gating drops it.
3. **Order Buy/Sell stays disabled even with amount + price + market filled** (sev: high). Gating is purely on `isConnected`; pre-connect there's no visible state telling the user "submit will simulate" or "submit needs connect".

## Handoffs
- To ALPHA:
  - Duplicate "Log in or sign up" CTAs on `/` (collapse to one).
  - Loan panel: bind Confirm CTA label to selected action (Lend/Withdraw/Borrow/Repay).
  - Privacy tab missing from `force-island` nav — add or route there.
  - Dynamic modal email submit arrow has no aria-label and isn't in a11y tree — label it for screen readers + automation.
- To BRAVO:
  - Loan APY/Supply/Borrow/Util/TVL all em-dashed in Loan/Borrow tab. Wire `useMorphoMarkets` to real on-chain data or fallback to a known fixture so the markets table doesn't look broken.
  - Trade order-submit path can't be exercised end-to-end because connect is broken (handoff to CHARLIE), but pre-connect the disabled state is unstyled — consider a "Simulate" mode tied to Ghost Mode that posts to the matcher without on-chain settlement.
- To CHARLIE:
  - Dynamic `emailVerifications/create` 403'd by Cloudflare from this local origin (curl confirmed). Either (a) move dogfood traffic behind a tunnel/IP allowlisted in Dynamic console, (b) flip the env to a Dynamic tenant without the Cloudflare rule, or (c) wire a dev-mode "skip OTP" path that mints a Turnkey wallet locally when `NODE_ENV=development`. Without this, NO subteam can dogfood any connect-gated flow.
  - Phone OTP option not exposed in modal — re-enable in Dynamic console so we have a fallback when email path is blocked.
  - cirBTC market on Arc Hub shows no LLTV and no addr — looks like a half-deployed market entry.
