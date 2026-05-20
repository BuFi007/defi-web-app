/**
 * Edge-runtime Sentry config. Used for middleware + edge-runtime Route
 * Handlers. Trimmed feature set vs the node config — no integrations
 * that depend on Node APIs.
 */
import type * as SentryNs from "@sentry/nextjs";

type SentryModule = typeof SentryNs;

export function initSentryEdge(Sentry: SentryModule): void {
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return;
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const release =
    process.env.SENTRY_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    undefined;

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: environment === "production" ? 0.1 : 0,
    sendDefaultPii: false,
  });
}
