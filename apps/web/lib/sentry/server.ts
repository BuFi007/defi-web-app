/**
 * Server-side Sentry init for the Next.js node/edge runtimes. No-ops unless
 * `SENTRY_DSN_WEB` is set AND `@sentry/nextjs` is installed.
 *
 * Init details live in `./sentry.server.config.ts` (Node) and
 * `./sentry.edge.config.ts` (Edge). This file is purely the dispatch +
 * dynamic-import shell so missing package can never crash server boot.
 *
 * Wired from `apps/web/instrumentation.ts` via Next.js's `register()` hook.
 */
import type * as SentryNs from "@sentry/nextjs";

export async function initWebSentryServer(): Promise<void> {
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return;
  try {
    const mod = (await import(/* @vite-ignore */ "@sentry/nextjs" as string).catch(
      () => null,
    )) as typeof SentryNs | null;
    if (!mod?.init) return;
    const runtime = process.env.NEXT_RUNTIME;
    if (runtime === "edge") {
      const { initSentryEdge } = await import("./sentry.edge.config");
      initSentryEdge(mod);
    } else {
      const { initSentryServer } = await import("./sentry.server.config");
      initSentryServer(mod);
    }
  } catch {
    // Swallow — observability must never crash server boot.
  }
}
