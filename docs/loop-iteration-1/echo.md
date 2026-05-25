# Team ECHO — Iteration 1

Branch: feat/wk1n14-privacy-pools-live @ 47f7286 (cacheComponents disabled)
Viewport: 1440x900 desktop, headless Chromium via /browse

## ECHO.1 — Trade flow
- Welcome card: **GREEN** render, **RED** interactivity. Screenshot `/tmp/echo-i1-01-home.png`, annotated `/tmp/echo-i1-02-home-annotated.png`. Card text matches spec: "Welcome / Please connect your wallet / 🚬🥃👻🕸️".
- Wallet connect modal: **NEVER OPENED**. There is **no "Log in or sign up" button on the NotConnectedHome card** — source at `apps/web/components/not-connected/index.tsx` renders only h1+2 paragraphs+emoji string. The only interactive UI is the header's `Open menu` hamburger (mobile-menu.tsx:150), which is the documented entry to the Dynamic widget.
- Hamburger menu also doesn't open: clicked via `$B click`, JS `.click()`, and `dispatchEvent` — `aria-expanded` stays `false`, no `[role=dialog]` or `[role=menu]` mounts, screenshot `/tmp/echo-i1-04-menu-attempt2.png`.
- **Root cause (functional bug #1): React never hydrated.** `document.querySelectorAll('*')` returns 256 elements, **0 carry a `__reactFiber*` key** after a 5s post-load wait + reload. `__NEXT_DATA__` is undefined. Static SSR HTML only. React DevTools + React Grab v0.1.37 console banners fire, so the bundle loads — hydration itself fails silently (no client error in console; suspected RSC payload mismatch from the cacheComponents toggle, or a missing/erroring `[locale]/layout.tsx` provider boundary).
- Console errors (non-WS): 1× past `GET / → 500` (16:24:46, before ALPHA's fix), 1× 403 same window, ongoing webpack-hmr WS handshake failures (every ~5s — dev HMR endpoint broken under Turbopack; cosmetic but spammy).
- Tab order pre-wallet: `a[BU.FI home]` → `button[Open menu]` → unlabeled `div` (focus trap leaks into Sentry/devtoolbar). Welcome card heading/paragraphs are not focusable. No skip-link.
- Reach: **stopped at "page renders welcome card"** because hydration is dead and the connect-wallet button does not exist in the static markup. No way to invoke Dynamic widget.

## ECHO.2 — Privacy flow
- Tab navigable: **NO**. `/privacy` returns 404 (`{locale}/page.tsx` is the only route under `app/[locale]/`). Privacy pools live inside the post-connect TradeIsland SPA; unreachable without hydration.
- Pools visible: **none** (cannot render — gated on `isConnectedAnyPath` in `components/home/index.tsx:43`).
- Status: **RED** (blocked by ECHO.1 hydration bug; cannot inspect MXNB/QCAD/cirBTC/AUDF presence).

## ECHO.3 — Loan flow
- Tab navigable: **NO**. Same blocker — no `/lend`, `/borrow`, `/markets` route; loan UI is mounted inside TradeIsland after wallet connect.
- Markets visible: **none**.
- Hardcoded APYs spotted: **n/a** (cannot reach UI). Code-level audit of EURC/tJPYC/MXNB/cirBTC Morpho markets deferred to CHARLIE.

## Top 3 UX bugs (pre-wallet)
1. Welcome card has **no call-to-action**. User sees "Please connect your wallet" but no button — must guess that the tiny hamburger top-right is the entry. First-time-trader friction is severe.
2. Hamburger ignores keyboard `Enter` and pointer `click` (separate from the React hydration bug — but invisible to user, who just sees "nothing happens, broken site").
3. Focus order leaks into the Next.js devtools overlay (`Select element`, `Collapse toolbar`) before any app content — devtools shipped to the alpha gate?

## Top 3 functional bugs (pre-wallet)
1. **CRITICAL: React client never hydrates** — 0 reactFiber keys across 256 DOM nodes. All interactivity dead. ALPHA's cacheComponents-disable fix made the page render but did not restore hydration. Without this, ZERO buttons work, Dynamic SDK never mounts, wallet connect impossible.
2. **Webpack HMR handshake fails every ~5s** in dev (`ws://127.0.0.1:3001/_next/webpack-hmr → ERR_INVALID_HTTP_RESPONSE`). Spams console; likely also breaks Fast Refresh and is a symptom of the same Turbopack/cacheComponents misconfiguration as #1.
3. Sentry + React-Grab + Next devtools all load on the alpha-gated page. Heavy bundle for what should be a public welcome card; also expands attack surface.

## Handoffs
- **To ALPHA**: render fixed the 500, but hydration is still broken (no client React on the page). Need to (a) confirm the `[locale]/layout.tsx` provider tree mounts client-side, (b) check whether `cacheComponents: false` toggle accidentally left an RSC payload that the client refuses to hydrate, (c) restore Welcome-card CTA button — even a placeholder `Connect Wallet` that triggers Dynamic. Verify with `document.querySelectorAll('[__reactFiber*]')` returning >0.
- **To BRAVO**: no contract calls reachable from UI; matcher integration test cannot be E2E-validated until ECHO.1 unblocks. Recommend BRAVO stand up a `/dev/trade-island?force=1` route bypassing the connect gate so matcher fills can be QA'd headlessly.
- **To CHARLIE**: cannot visually confirm MXNB/QCAD/cirBTC missing-deployment UI. Please code-audit `packages/location/src/deployments.ts` callers and confirm whether the "Pending" pill is wired or just absent. Also: the alpha-gate ships Sentry/React-Grab/Next-devtools — intended?
