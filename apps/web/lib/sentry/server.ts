/**
 * Server-side Sentry init for the Next.js node/edge runtimes. No-ops unless
 * `SENTRY_DSN_WEB` is set AND `@sentry/nextjs` is installed.
 *
 *   bun add @sentry/nextjs      # only when SENTRY_DSN_WEB is set
 *
 * Wired from `apps/web/instrumentation.ts` via Next.js's `register()` hook.
 */
export async function initWebSentryServer(): Promise<void> {
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return;
  try {
    const mod = (await import(/* @vite-ignore */ "@sentry/nextjs" as string).catch(
      () => null,
    )) as { init?: (opts: Record<string, unknown>) => void } | null;
    if (!mod?.init) return;
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    });
  } catch {
    // Swallow — observability must never crash server boot.
  }
}
