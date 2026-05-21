# `@bufi/observability`

OpenTelemetry traces → Axiom OTLP/HTTP exporter for `apps/api` and every
`apps/keeper-*` service. Production-grade traces (not log-prints) for
Pillar 7 (Infrastructure & SRE) of the production-perps roadmap.

## What you get

- **`initOtel({ serviceName })`** — one-shot SDK bootstrap. NoOp when
  `AXIOM_TOKEN` is unset, full OTLP exporter when set. Safe to call multiple
  times (subsequent calls are ignored).
- **`withSpan(name, fn, attrs?)`** / **`withSpanSync(name, fn, attrs?)`** —
  wrap any async/sync function in a span. Records exceptions, sets status,
  re-throws.
- **`getTracer(name)`** — cached `@opentelemetry/api` tracer.
- **Hono middleware** (lives in `apps/api/src/middleware/otel.ts`) — emits
  one span per inbound HTTP request with `http.method`, `http.route`,
  `http.status_code`.
- **Keeper tick wrapper** (lives in `packages/keeper-runtime/src/index.ts`) —
  every `runKeeper({...}).tick(ctx)` invocation gets its own span with
  `keeper.name`, `tick.index`, `tick.duration_ms`.

## Required envs

| Env | Required when | Default | Notes |
|---|---|---|---|
| `AXIOM_TOKEN` | Always for tracing to fire | — | When unset, the SDK is never loaded and every `tracer.startSpan(...)` is a free no-op. |
| `AXIOM_TRACES_DATASET` | Optional | `bufi-traces` | One dataset per environment is the recommended layout. |
| `OTEL_SERVICE_VERSION` | Optional | `npm_package_version` or `"0.0.0"` | Stamped on every span via `service.version`. |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | Optional | `NODE_ENV` or `"development"` | Stamped via `deployment.environment`. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional | `https://api.axiom.co/v1/traces` | Override for a self-hosted OTLP collector or non-US Axiom region. |

## Local dev

Just don't set `AXIOM_TOKEN`. Every span call collapses to a NoOp — no
exporter, no batch processor, no HTTP requests, no measurable startup cost.

## Axiom dataset bootstrap

One-time, per environment. Either UI:

> Settings → Datasets → New dataset → name = `bufi-traces`

Or CLI (`brew install axiomhq/tap/axiom`):

```bash
axiom auth login
axiom dataset create bufi-traces
axiom token create --dataset bufi-traces --permissions ingest > .axiom-token
```

Then plumb `.axiom-token` into your deploy secrets as `AXIOM_TOKEN`.

## Per-app naming convention

`service.name` is the only stable handle Axiom shows in the trace explorer.
Use the prefixes consistently:

| Service | `serviceName` |
|---|---|
| `apps/api` | `bufi-api` |
| `apps/keeper-perps-matcher` | `keeper.perps-matcher` |
| `apps/keeper-perps-funding` | `keeper.perps-funding` |
| `apps/keeper-perps-liquidator` | `keeper.perps-liquidator` |
| `apps/keeper-telarana-liquidator` | `keeper.telarana-liquidator` |
| `apps/keeper-gateway-signer` | `keeper.gateway-signer` |
| `apps/keeper-spot` | `keeper.spot` |
| `apps/keeper-arcade-settler` | `keeper.arcade-settler` |
| `apps/keeper-pyth` | `keeper.pyth` |

## Why manual instrumentation (not `sdk-node`)

`@opentelemetry/sdk-node`'s auto-instrumentations rely on Node's
`module._extensions` hooks. Bun has its own module loader and those hooks
don't reliably fire under Bun — so HTTP/Fetch auto-spans silently disappear.

We use `@opentelemetry/sdk-trace-node` (the manual provider) and emit spans
explicitly via Hono middleware (one per request) and the keeper runtime
(one per tick). It's a few more lines of code but the spans we ship are
the ones we actually care about and they show up the same way on Bun and
Node.
