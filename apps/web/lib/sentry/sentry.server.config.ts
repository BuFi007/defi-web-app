/**
 * Server-side (Node.js runtime) Sentry config. Captures SSR errors,
 * Route Handler throws, and Server Action failures. No browser replay
 * here — that's a client-only integration.
 */
import type * as SentryNs from "@sentry/nextjs";

type SentryModule = typeof SentryNs;

export function initSentryServer(Sentry: SentryModule): void {
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
