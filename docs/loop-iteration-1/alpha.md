# Team ALPHA — Iteration 1

## ALPHA.1 — Hydration fix

### Root cause
`apps/web/context/ClientProviders.tsx` wraps the wallet provider stack
(`DynamicContextProvider` → `WagmiProvider` → `BlockchainProvider` etc.) via
`next/dynamic(... { ssr: false })`. Under Next 16 + `cacheComponents: true`
(PPR) that combination fires `BAILOUT_TO_CLIENT_SIDE_RENDERING` during the
SSR pass on `/[locale]/page.tsx`.

The bailout propagates UP through every client-component Suspense boundary
in the `[locale]` layout — `ThemeProvider`, `I18nProviderClient`,
`TranslationProvider`, `GhostModeProvider` — because client-component
Suspense boundaries do NOT catch server-side CSR bailouts inside a
prerender dynamic hole (created by `LocalizedShell`'s `await params`). The
bailout walks all the way up to the only **server**-side Suspense — the
one in `app/layout.tsx:40` with `<Suspense fallback={null}>` — at which
point Next streams a body containing nothing but the `null` fallback +
the BAILOUT template + RSC payload.

Trace (server stderr / HTML `data-stck` attribute):
```
Error: Bail out to client-side rendering: next/dynamic
  at BailoutToCSR (.../node_modules_next_0g~71op._.js:60:37)
  at react_stack_bottom_frame
  at renderWithHooks
  ...
  at renderElement   ← ClientProviders
  at renderElement   ← GhostModeProvider
  at renderElement   ← TranslationProvider
  at renderElement   ← I18nProviderClient
  at renderElement   ← LocalizedShell (async — dynamic hole)
  at finishFunctionComponent
```

### Attempt log
1. **Added a `<Suspense fallback={null}>` around `<Providers>` in
   `[locale]/layout.tsx`.** No effect — the surrounding providers
   (`GhostModeProvider`, etc.) are client components, and a Suspense
   declared inside a client component doesn't catch server CSR bailouts
   inside a dynamic hole. Reverted.

2. **Replaced `next/dynamic({ ssr: false })` in `ClientProviders` with a
   `useEffect` + `useState(mounted)` gate, importing `DynamicProviders`
   eagerly at module top.** Server-side it renders `null`; on mount it
   renders the providers. This DID eliminate the BAILOUT_TO_CSR error —
   curl confirms `data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"` is gone
   from the HTML, body is structurally valid, and the dev server log
   shows `✓ Compiled in 2.9s` with no React errors.

3. **Verified the SSR change in browser** (gstack `/browse` driving a
   real Chromium):
   - `curl http://127.0.0.1:3001/en` → HTML 180 KB, no BAILOUT, body
     contains valid React stream markers.
   - Browser hydration → `document.body.innerText.length === 0` even
     after waiting 15 s. React Grab + DevTools attach, RSC payload
     pushes into `__next_f` correctly, but the `useEffect` in
     `ClientProviders` apparently never fires — no console output from
     instrumented `console.log("[ClientProviders] useEffect fired…")`
     reached the browser console.

### Files changed
- `apps/web/context/ClientProviders.tsx` — replaced `dynamic({ ssr: false })`
  pattern with eager static import of `DynamicProviders` + `useEffect`/
  `useState`-gated render. (lines 1–62 rewritten with new implementation
  + a long IMPLEMENTATION NOTE warning future readers not to revert.)

### Verification
| Check | Before fix | After fix |
|---|---|---|
| `data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"` in HTML | present | gone |
| `data-msg` "Bail out to client-side rendering: next/dynamic" | present | gone |
| Body has any visible text in browser after 15 s hydrate | empty | **still empty** |
| Dev server compile errors | none | none |
| `useEffect` instrumentation fires in browser | n/a | **never fires** |

```bash
$ curl -sL -b /tmp/cj http://127.0.0.1:3001/en > /tmp/en.html
$ grep -c BAILOUT /tmp/en.html
0
$ wc -c /tmp/en.html
  180529 /tmp/en.html
```

### Status
**RED — NEEDS_HELP**

The BAILOUT_TO_CSR error is eliminated (the headline symptom from
iteration 0 is gone), but the page still does not render visible
content in the browser. The deferred-mount approach in `ClientProviders`
appears to not be triggering a client re-render — useEffect never fires
according to instrumented logging. Possible suspects:

1. React 19 + cacheComponents + a "use client" boundary that returns
   `null` on SSR might be aborting hydration entirely (no client tree to
   reconcile against → no useEffect ever runs). Worth testing whether
   returning a stable `<div hidden>` instead of `null` makes the
   hydration commit.
2. The `app/layout.tsx:40` `<Suspense fallback={null}>` may need a real
   skeleton fallback so that a CSR re-render has somewhere to mount.
3. The deeper architectural fix is to pull the chrome (Header, Container,
   children) out of `<Providers>` entirely so it can SSR without the
   wallet stack, then mount the wallet stack as a sibling. That's a
   refactor outside the scope of a single iteration but is the durable
   fix.

A second pair of eyes (BRAVO or ECHO) should look at whether (1) is
correct and try the `<div hidden>` placeholder approach, or whether
removing `cacheComponents: true` from `next.config.mjs` (after restarting
the dev server — note `landing-layout.tsx:67` uses `"use cache"` which
requires `cacheComponents`, so that must also be removed) is the
expedient fix for beta.

## ALPHA.2 — Tab QA

The runbook lists Trade / Pools / Privacy / Lend-Borrow / Positions /
History as separate tabs, but the codebase only has ONE locale route:
`apps/web/app/[locale]/page.tsx` → `<HomeContent />`. The "tabs" are all
internal state inside the `TradeIsland` component (`apps/web/components/
trade-island/index.tsx`). There is no route-level navigation between
them.

| Tab | Route | Renders? | Evidence |
|---|---|---|---|
| Trade | `/en` (TradeIsland default) | ❌ no (blocked by ALPHA.1) | curl 180 KB, body empty, BAILOUT gone but no React render |
| Pools | `/en` (TradeIsland internal tab) | ❌ no (same blocker) | same |
| Privacy | `/en` (TradeIsland internal tab) | ❌ no (same blocker) | same |
| Lend / Borrow | `/en` (TradeIsland → LoanTab) | ❌ no (same blocker) | same |
| Positions | `/en` (TradeIsland → positions panel) | ❌ no (same blocker) | same |
| History | `/en` (TradeIsland → trades panel) | ❌ no (same blocker) | same |

All tabs are gated on the same `HomeContent` → `useBufiIsConnected()` →
`TradeIsland` render path, so they all share the ALPHA.1 blocker. None
of them have their own route file under `apps/web/app/`.

`/alpha` (the password gate) renders correctly — its layout doesn't go
through `ClientProviders`:
```bash
$ curl -sL http://127.0.0.1:3001/alpha | grep -c "Welcome to Telaraña"
1
```

## ALPHA.3 — Locale routing

### Findings
The middleware (`apps/web/proxy.ts`) does:
1. `/en` (with locale prefix) → `stripLocalePrefix` → 307 redirect to `/`
   + sets `Next-Locale=en` cookie.
2. `/` → `I18nMiddleware` (from `next-international`) → internal
   **rewrite** to `/en` (the actual filesystem route).
3. The browser address bar stays at `/`. The URL `/en` only appears in
   `<link rel="alternate" hreflang="en" href="https://fx.bu.finance/en">`
   metadata.

**No infinite redirect risk** — step 1 returns 307 to `/`, step 2 is a
rewrite (not a redirect), so the redirect chain ends after one hop. The
`stripLocalePrefix` early-exits when `pathname` doesn't start with a
locale segment.

### Conclusion: the runbook's claim that "Trade Island lives on /en" is
**half-correct** — `/en` is the canonical SEO URL but the runtime URL is
`/`. The page tree is rooted at `apps/web/app/[locale]/page.tsx` which
serves `/` via the i18n rewrite, and `/en` via the 307 → `/` redirect
chain. Both URLs ultimately render the same `[locale]/page.tsx` content.

### Doc updates
- `docs/loop-12h-prompt.md` was already correct about the route living
  on `/en` (the SEO-canonical URL). It does not need a clarification
  because both `/en` and `/` reach the same component tree, and a user
  typing `/en` will land on the right page after the 307 → `/` →
  internal rewrite sequence completes.
- `docs/dogfood-2026-05-24.md` does not exist in the repo. The most
  recent dogfood doc is `docs/dogfood-2026-05-23.md` and it doesn't
  reference the route directly. No update needed.

## Handoffs

### To ECHO
**NO-GO on tab QA until ALPHA.1 is fully fixed.** The BAILOUT error is
gone (curl-verified) but the browser still renders an empty body. Until
a single tab renders, ECHO cannot verify wallet connection, swap, or
loan flows. Recommended next step for ECHO:
1. Read this alpha.md, understand the deferred-mount approach in
   `ClientProviders.tsx`.
2. Try replacing `return null` with `return <div hidden suppressHydrationWarning />`
   to see if a stable placeholder triggers hydration commit.
3. If that fails, try changing `app/layout.tsx:40` `<Suspense fallback={null}>`
   to `<Suspense fallback={<div className="min-h-screen" />}>`.
4. As an escape hatch — remove `cacheComponents: true` from
   `apps/web/next.config.mjs` AND remove the `"use cache"` directive
   from `apps/web/lib/seo/landing-layout.tsx:67` (which depends on it),
   then restart the dev server. That disables PPR but should restore
   normal SSR + hydration.

### To BRAVO
No UI data-shape changes — the design is frozen and the bug is purely a
rendering-pipeline bailout, not a data contract issue. BRAVO is free to
work on whatever else is in the queue.
