import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://5bf772dafa17c3761d6a15af6e641609@o4507693954301952.ingest.de.sentry.io/4511450917830736",

  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserProfilingIntegration(),
  ],

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  profileSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  profileLifecycle: "trace",

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
