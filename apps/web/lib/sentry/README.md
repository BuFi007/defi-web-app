# Sentry on `apps/web`

Browser + SSR + edge error capture and session replay for the BUFI web app.
Pillar 7 (Infrastructure & SRE) of the production-grade perps roadmap
(`docs/roadmap-production-perps.md`, PR #46).

## What's wired

- **Client init** — `SentryClientInit` mounted in `app/layout.tsx`; calls
  `initWebSentryClient()` which dynamic-imports `@sentry/nextjs` and
  delegates to `sentry.client.config.ts`. Includes `replayIntegration`.
- **Server init** — `instrumentation.ts` → `initWebSentryServer()`
  dispatches by `NEXT_RUNTIME` to either `sentry.server.config.ts`
  (Node) or `sentry.edge.config.ts` (Edge).
- **Tunnel route** — `app/api/sentry-tunnel/route.ts` proxies envelopes to
  Sentry ingest server-side so ad-blockers can't drop them.
- **Source-map upload** — `next.config.mjs` wraps the config with
  `withSentryConfig` when `SENTRY_DSN_WEB` is set. Source maps are
  hidden from the deployed bundle but uploaded to Sentry for
  symbolication when `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
  are all present.

Every layer no-ops cleanly when the DSN is unset, so dev workspaces and
forks don't need any Sentry setup to build.

## Required environment variables

| Variable                                          | Where      | Purpose                                            |
| ------------------------------------------------- | ---------- | -------------------------------------------------- |
| `SENTRY_DSN_WEB`                                  | runtime    | Server-side init (SSR + tunnel + edge)             |
| `NEXT_PUBLIC_SENTRY_DSN_WEB` (or `SENTRY_DSN_WEB`)| runtime    | Browser SDK init (must be `NEXT_PUBLIC_*` to inline) |
| `SENTRY_AUTH_TOKEN`                               | build-time | Source-map upload                                  |
| `SENTRY_ORG`                                      | build-time | Sentry org slug for source-map upload              |
| `SENTRY_PROJECT`                                  | build-time | Sentry project slug for source-map upload          |
| `NEXT_PUBLIC_BUFI_API_BASE`                       | runtime    | Origin allowlist for replay network detail capture |
| `NEXT_PUBLIC_SENTRY_RELEASE` (optional)           | runtime    | Falls back to `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`  |
| `SENTRY_RELEASE` (optional)                       | runtime    | Falls back to `VERCEL_GIT_COMMIT_SHA`              |

## Replay policy

- `maskAllText: false` — UI labels, prices, market names are public data;
  not masking them keeps replays useful for triage.
- `maskAllInputs: true` — any `<input>` is masked. Wallet addresses,
  order amounts, and other potentially-sensitive inputs never reach
  Sentry's storage.
- `blockAllMedia: false` — we don't render user-uploaded media.
- `networkDetailAllowUrls: [NEXT_PUBLIC_BUFI_API_BASE]` — request bodies +
  headers are captured ONLY for our own API. Third-party calls (Pyth
  Hermes, Circle, public RPCs) get URL-only entries so we never leak
  third-party auth tokens or PII.
- `replaysSessionSampleRate: 0.05` (5% of sessions get a replay).
- `replaysOnErrorSampleRate: 1.0` (every errored session is replayed).

## Verifying locally

1. Set `SENTRY_DSN_WEB` in `.env.local`.
2. `bun run --filter ./apps/web dev`.
3. Open the app, then in DevTools console run:

   ```js
   const Sentry = await import('@sentry/nextjs');
   Sentry.captureMessage('tunnel smoke test');
   ```

4. Watch the Network tab for a `POST /api/sentry-tunnel` (200) — that's
   the tunnel forwarding the envelope.
5. Confirm the event lands in your Sentry project.

To verify replay capture, throw an error in any client component and
look for a "Replays" tab on the Sentry issue.

## Verifying source-map upload (CI / Vercel)

Set `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` in your build
environment. On `bun run build`, the Sentry webpack/turbopack plugin
will upload source maps; the build log will show "Sentry CLI: Uploaded
N source maps". Without those three envs the plugin no-ops silently and
the build remains identical to a no-Sentry build.
