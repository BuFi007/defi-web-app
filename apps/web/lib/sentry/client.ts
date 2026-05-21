/**
 * Browser-side Sentry init. No-ops unless `NEXT_PUBLIC_SENTRY_DSN_WEB`
 * (or `SENTRY_DSN_WEB` inlined at build) is set AND `@sentry/nextjs` is
 * installed.
 *
 * Init details (replay integration, sample rates, network scope, tunnel)
 * live in `./sentry.client.config.ts`. This file is purely the
 * fail-safe dynamic-import shell so a missing package can never crash
 * a page load.
 */
import type * as SentryNs from "@sentry/nextjs";

export async function initWebSentryClient(): Promise<void> {
  const dsn =
    process.env.NEXT_PUBLIC_SENTRY_DSN_WEB ??
    process.env.SENTRY_DSN_WEB;
  if (!dsn) return;
  try {
    const mod = (await import(/* @vite-ignore */ "@sentry/nextjs" as string).catch(
      () => null,
    )) as typeof SentryNs | null;
    if (!mod?.init) return;
    const { initSentryClient } = await import("./sentry.client.config");
    initSentryClient(mod);
  } catch {
    // Swallow — observability must never crash a page load.
  }
}
