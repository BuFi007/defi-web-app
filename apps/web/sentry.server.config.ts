import * as Sentry from "@sentry/nextjs";

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type SentryIntegrations = Exclude<SentryInitOptions["integrations"], undefined>;

const integrations: SentryIntegrations = [];

if (process.env.SENTRY_NODE_PROFILING === "1") {
  try {
    const { nodeProfilingIntegration } = await import("@sentry/profiling-node");
    integrations.push(nodeProfilingIntegration());
  } catch (err) {
    console.warn(
      "[sentry] node profiling disabled:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

Sentry.init({
  dsn: "https://5bf772dafa17c3761d6a15af6e641609@o4507693954301952.ingest.de.sentry.io/4511450917830736",

  integrations,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  ...(integrations.length > 0
    ? {
        profileSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
        profileLifecycle: "trace" as const,
      }
    : {}),

  includeLocalVariables: true,
  enableLogs: true,
  sendDefaultPii: true,
});
