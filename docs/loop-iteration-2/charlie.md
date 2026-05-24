# Team CHARLIE — Iteration 2

## CHARLIE.1 — Deployments fix
- Files changed:
  - `packages/location/src/deployments.ts` (Arc row: dropped AUDF, added MXNB + CIRBTC)
  - `packages/location/src/stable-tokens.ts` (added `CIRBTC` to `StableTokenType` + `StableTokenMap`)
  - `apps/web/components/trade-island/loan.tsx` (uppercase `symbol` before `getDeployment` so "cirBTC" rows resolve)
- Commit: `2cfe51b` (bundled with BRAVO commit due to parallel-team race — diff includes all four CHARLIE files; verified `git show 2cfe51b --stat`)
- Status: **GREEN** — `bun test packages/contracts/src/index.test.ts` 3 pass; `bunx tsc --noEmit -p apps/web` clean
- Arc deployments now match BRAVO iter-1's confirmed live set: USDC, EURC, MXNB, cirBTC (tJPYC still out of scope for the deployments table — JPYC was never listed for any chain, so wallet popover doesn't surface it; out-of-scope per task instructions).

## CHARLIE.2 — cirBTC decimals
- Files changed: same `deployments.ts` + `stable-tokens.ts` from CHARLIE.1.
- Strategy: set `decimals: 8` on the Arc CIRBTC deployment row. The consumer in `apps/web/components/stablecoin-balances/index.tsx:81` reads `deployment?.decimals ?? 6`, so as long as the deployment row carries 8, the fallback is never hit for cirBTC. No other hardcoded-decimals call site needs editing for cirBTC.
- Math check: 1e8 atomic units of cirBTC with `formatUnits(1e8, 8)` = "1.00000000" cirBTC. Previously with `decimals=6` it would have rendered as "100" cirBTC (100x too large).
- Status: **GREEN**.

## CHARLIE.3 — Network switcher + dynamic login QA
- Test account login: **FAILED** — Dynamic OTP creation blocked by upstream CORS / rate-limit.
  - First `createEmailVerification` POST returned HTTP 4xx "Request failed. You may be sending too many requests" (Dynamic-side rate limit, likely shared across the 6 parallel teams + ECHO hitting `tomas.cordero.esp+dynamic_test@gmail.com` in the same window).
  - Subsequent retries are **CORS-blocked**: `Access to fetch at 'https://app.dynamicauth.com/api/v0/sdk/8f49e843-…/emailVerifications/create' from origin 'https://localhost:3001' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present`.
  - **Root cause is dashboard config, not app code**: the Dynamic environment (env id `8f49e843-08dc-4654-a1fd-36b1dc59d709`) likely only allow-lists `http://localhost:3000`. Iter-2 moved web to HTTPS on :3001 (per dev:up changes) but the Dynamic env wasn't updated to allow the new origin.
- Network correct: **UNVERIFIED** (couldn't log in to check the connected network selector).
- Balances visible: **N/A** (wallet not connected). Pre-connect, the stablecoin pill shows "—" as expected.
- Screenshots:
  - `/tmp/charlie-i2-01-landing.png` — landing with Dynamic login modal open
  - `/tmp/charlie-i2-04-modal.png` — login modal pre-submit
  - `/tmp/charlie-i2-05-otp.png` — Dynamic rate-limit error after first submit
  - `/tmp/charlie-i2-06-otp-retry.png` — retry after 45s: same error (CORS blocking subsequent requests entirely)

## Handoffs
- **To ECHO**: Real dogfood via the Dynamic test account is **blocked** until someone with Dynamic dashboard access adds `https://localhost:3001` to the env-id `8f49e843-08dc-4654-a1fd-36b1dc59d709` allowed-origins list. Once that's done, the 3 deployment bugs are fixed and the wallet popover should render USDC + EURC + MXNB + cirBTC balances on Arc (no more permanent "Pending" rows) with correct cirBTC decimals.
- **To FOXTROT / DELTA (whoever owns dashboard)**: Add `https://localhost:3001` (and any other dev HTTPS ports planned) to Dynamic env allowed origins. Document in `docs/beta-onboarding.md` so future contributors don't trip on it. Also worth checking whether the test account `tomas.cordero.esp+dynamic_test@gmail.com` is hitting per-account OTP rate-limit ceilings — if so, provision a small pool of test accounts so parallel-team loops don't trample each other.
- **Code state on branch `feat/wk1n14-privacy-pools-live` HEAD**: the three bug fixes are in commit `2cfe51b` (note: commit message attributes only BRAVO's docs — the diff is the union of BRAVO's `.md` + all CHARLIE source fixes due to the simultaneous `git commit` race).
