import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://5bf772dafa17c3761d6a15af6e641609@o4507693954301952.ingest.de.sentry.io/4511450917830736",

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  enableLogs: true,
  sendDefaultPii: true,
});
