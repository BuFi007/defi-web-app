/**
 * Sentry scaffolding for the API.
 *
 * No-ops unless `SENTRY_DSN_API` is set AND `@sentry/node` is installed.
 *
 *   bun add @sentry/node            # only needed when you set the DSN
 *
 * The dynamic import + try/catch makes the missing package a silent no-op,
 * so dev/test environments don't need the dependency installed.
 */
export async function initApiSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN_API;
  if (!dsn) return;
  try {
    // Dynamic import so the package is only resolved when an operator opts in
    // by setting the DSN. Type cast to `unknown` keeps the dependency optional
    // from TypeScript's perspective.
    const mod = (await import(/* @vite-ignore */ "@sentry/node" as string).catch(
      () => null,
    )) as { init?: (opts: Record<string, unknown>) => void } | null;
    if (!mod?.init) return;
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    });
  } catch {
    // Swallow — observability must never crash the app boot path.
  }
}
