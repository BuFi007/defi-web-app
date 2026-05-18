/**
 * Browser-side Sentry init. No-ops unless `NEXT_PUBLIC_SENTRY_DSN_WEB`
 * (or `SENTRY_DSN_WEB` inlined at build) is set AND `@sentry/nextjs` is
 * installed.
 *
 *   bun add @sentry/nextjs      # only when SENTRY_DSN_WEB is set
 *
 * Safe to call unconditionally; dynamic import + try/catch makes a missing
 * package a silent no-op.
 */
export async function initWebSentryClient(): Promise<void> {
  const dsn =
    process.env.NEXT_PUBLIC_SENTRY_DSN_WEB ??
    process.env.SENTRY_DSN_WEB;
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
    // Swallow — observability must never crash a page load.
  }
}
