/**
 * Sentry browser SDK config. Imported by `SentryClientInit` and invoked via
 * dynamic import so a missing DSN / missing package stays a no-op.
 *
 * Replay integration policy:
 *   - `maskAllText: false`  — buttons, prices, labels are public market data.
 *   - `maskAllInputs: true` — wallet addresses + order amounts can leak via
 *     replay screenshots; mask them defensively.
 *   - `blockAllMedia: false` — we render no user-uploaded media.
 *   - `networkDetailAllowUrls: [bufiApiBase]` — capture request bodies +
 *     headers ONLY for our own API. Pyth Hermes, Circle, public RPCs etc.
 *     get URL-only entries so we never leak third-party auth or PII.
 *
 * Sample rates:
 *   - 5% of all sessions replayed (`replaysSessionSampleRate: 0.05`).
 *   - 100% of error sessions replayed (`replaysOnErrorSampleRate: 1`).
 *
 * Tunnel:
 *   - All envelopes routed through `/api/sentry-tunnel` so ad-blockers
 *     don't drop browser-side error telemetry.
 */
import type * as SentryNs from "@sentry/nextjs";

type SentryModule = typeof SentryNs;

/**
 * Resolve the BUFI API origin so we can scope `networkDetailAllowUrls` to
 * our own backend. Falls back to same-origin (the Next app proxies the
 * API at `/api/*` in production) when unset.
 */
function resolveBufiApiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_BUFI_API_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "/api";
  return raw;
}

export function initSentryClient(Sentry: SentryModule): void {
  const dsn =
    process.env.NEXT_PUBLIC_SENTRY_DSN_WEB ?? process.env.SENTRY_DSN_WEB;
  if (!dsn) return;

  const bufiApiBase = resolveBufiApiBase();
  const environment = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const release =
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    undefined;

  Sentry.init({
    dsn,
    environment,
    release,
    tunnel: "/api/sentry-tunnel",
    tracesSampleRate: environment === "production" ? 0.1 : 0,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: false,
        maskAllInputs: true,
        blockAllMedia: false,
        networkDetailAllowUrls: [bufiApiBase],
      }),
    ],
    // Don't ship breadcrumbs that include localStorage / cookie payloads.
    sendDefaultPii: false,
  });
}
