/**
 * Next.js 16 instrumentation hook. Fires once per runtime (`nodejs` | `edge`)
 * before the first request. We use it to wire Sentry; the underlying init
 * helpers are no-ops when `SENTRY_DSN_WEB` is unset or `@sentry/nextjs` isn't
 * installed, so this stays safe in pure-dev workspaces.
 */
export async function register(): Promise<void> {
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === "nodejs" || runtime === "edge") {
    const { initWebSentryServer } = await import("./lib/sentry/server");
    await initWebSentryServer();
  }
}
