/**
 * One-shot OpenTelemetry initializer.
 *
 * Boot pattern (mirrors apps/api/src/sentry.ts):
 *
 *   import { initOtel } from "@bufi/observability";
 *   void initOtel({ serviceName: "bufi-api" });
 *
 * Behaviour:
 *   - `AXIOM_TOKEN` unset (default, local dev, CI): registers a NoOp tracer
 *     provider, so every `tracer.startSpan(...)` is a free no-op. No exporter,
 *     no HTTP requests, no perf impact, no log spam.
 *   - `AXIOM_TOKEN` set: registers a `NodeTracerProvider` with a batch span
 *     processor pointing at Axiom's OTLP/HTTP trace endpoint.
 *
 * We deliberately use `sdk-trace-node` (manual instrumentation) instead of
 * `sdk-node` (auto-instrumentations). Bun ships its own module loader and
 * auto-instrumentations that monkey-patch Node's core modules don't reliably
 * apply under Bun. Manual `withSpan(...)` / Hono middleware lets us emit the
 * spans we actually want, deterministically, on both Node and Bun.
 */

export interface InitOtelOptions {
  /** Logical service name — e.g. "bufi-api", "keeper.perps-matcher". Required. */
  serviceName: string;
  /** Override the dataset; defaults to AXIOM_TRACES_DATASET || "bufi-traces". */
  dataset?: string;
  /** Override the deployment env; defaults to OTEL_DEPLOYMENT_ENVIRONMENT || NODE_ENV || "development". */
  environment?: string;
  /** Override the service version; defaults to OTEL_SERVICE_VERSION || npm_package_version || "0.0.0". */
  serviceVersion?: string;
}

let initialised = false;

export async function initOtel(opts: InitOtelOptions): Promise<void> {
  if (initialised) return;
  initialised = true;

  const token = process.env.AXIOM_TOKEN;
  if (!token) {
    // NoOp mode. We don't even import the SDK — the global `trace.getTracer`
    // returned by `@opentelemetry/api` is itself a NoOp when no provider is
    // registered, so downstream `withSpan(...)` callers stay zero-cost.
    return;
  }

  const dataset =
    opts.dataset ?? process.env.AXIOM_TRACES_DATASET ?? "bufi-traces";
  const environment =
    opts.environment ??
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT ??
    process.env.NODE_ENV ??
    "development";
  const serviceVersion =
    opts.serviceVersion ??
    process.env.OTEL_SERVICE_VERSION ??
    process.env.npm_package_version ??
    "0.0.0";

  try {
    // Dynamic imports so the SDK is only resolved when an operator opts in.
    // Cast to `unknown` keeps the dependency types isolated from the public
    // surface — `@opentelemetry/api` is still a static import elsewhere.
    const [{ Resource }, { NodeTracerProvider }, sdkTraceBase, exporterMod, semconv] =
      await Promise.all([
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-trace-node"),
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/semantic-conventions"),
      ]);

    const { BatchSpanProcessor } = sdkTraceBase;
    const { OTLPTraceExporter } = exporterMod;
    const {
      SEMRESATTRS_SERVICE_NAME,
      SEMRESATTRS_SERVICE_VERSION,
      SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
    } = semconv;

    const exporter = new OTLPTraceExporter({
      // Axiom's OTLP/HTTP traces endpoint.
      url:
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
        "https://api.axiom.co/v1/traces",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Axiom-Dataset": dataset,
      },
    });

    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: opts.serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
      }),
    });

    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    // Flush on process exit so we don't drop the final batch.
    const shutdown = async (): Promise<void> => {
      try {
        await provider.shutdown();
      } catch {
        // best-effort
      }
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
    process.once("beforeExit", () => void shutdown());
  } catch (err) {
    // Observability must never crash the app boot path. If anything goes
    // sideways (missing peer dep, bad URL, dynamic import failure) we fall
    // back to NoOp tracing silently.
    // eslint-disable-next-line no-console
    console.warn(
      "[observability] failed to initialise OTel; falling back to NoOp:",
      (err as Error).message,
    );
  }
}
