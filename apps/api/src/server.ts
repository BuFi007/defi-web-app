import { Hono } from "hono";
import type { ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createLogger } from "@bufinance/logger";
import { createLogger as createStructuredLogger, type Logger } from "@bufi/logger";
import { initOtel } from "@bufi/observability";
import {
  createCorsMiddleware,
  errorHandler,
  notFoundHandler,
  requestContext,
  type RequestContext,
} from "@bufinance/worker-base";

import { otelMiddleware } from "./middleware/otel";
import { fxBentoRoutes } from "./routes/fx-bento";
import { fxTelaranaRoutes } from "./routes/fx-telarana";
import { liveblocksRoutes } from "./routes/liveblocks";
import { marketsRoutes } from "./routes/markets";
import { mcpRoutes } from "./routes/mcp";
import { perpsRoutes } from "./routes/perps";
import { realtimeRoutes } from "./routes/realtime";
import { spotRoutes } from "./routes/spot";
import {
  bootWebhookSurface,
  mountWebhookRoutes,
} from "./routes/webhooks";
import {
  makeUpgradeData,
  marketsWebSocketHandler,
  parseMarketsWsPath,
} from "./routes/ws";
import { x402Routes } from "./routes/x402";
import { initApiSentry } from "./sentry";
import { walletSession } from "./wallet-session";

declare module "hono" {
  interface ContextVariableMap {
    requestContext: RequestContext;
    requestId: string;
    log: Logger;
  }
}

// Fire-and-forget Sentry init. No-ops if SENTRY_DSN_API is unset or the
// @sentry/node package isn't installed.
void initApiSentry();
// Fire-and-forget OpenTelemetry init. NoOp tracer when AXIOM_TOKEN is unset
// so local dev pays zero perf cost; full OTLP exporter to Axiom when set.
void initOtel({ serviceName: "bufi-api" });

// Top-level app is OpenAPIHono — `OpenAPIHono` extends `Hono`, so every
// downstream `.use`, `.route`, `.onError`, `.notFound` still types and
// behaves identically. Routes that opt into typed request/response
// schemas (currently just /health; markets.ts is route #2 in a
// follow-up PR) use `app.openapi(route, handler)`. Plain `.get/.post`
// still work for routes that haven't been converted.
const app = new OpenAPIHono();
const log = createLogger({ prefix: "bufx-api" });
const corsMiddleware = createCorsMiddleware({
  origins: {
    development: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
    ],
    production: (process.env.API_CORS_ORIGINS ?? "https://bu.finance")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  fallbackEnv:
    process.env.NODE_ENV === "production" ? "production" : "development",
  envKey: "NODE_ENV",
  headers: {
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Request-Id",
      "X-Wallet-Address",
      "X-Wallet-ChainId",
      "X-Wallet-Message",
      "X-Wallet-TypedData",
      "X-Wallet-Signature",
      "Payment-Signature",
      // Set by apps/web/lib/api-client.ts resilientFetch on POST/PUT/PATCH.
      "Idempotency-Key",
    ],
    exposeHeaders: ["X-Request-Id", "X-Response-Time"],
    maxAge: 600,
    credentials: true,
  },
}) as unknown as MiddlewareHandler;
const requestContextMiddleware =
  requestContext as unknown as () => MiddlewareHandler;

app.use("*", requestContextMiddleware());
// Span-per-request. Mounted right after requestContext so the span covers
// every downstream middleware (CORS, wallet session, structured logger)
// AND the route handler. NoOp when AXIOM_TOKEN is unset.
app.use("*", otelMiddleware());
app.use("*", corsMiddleware);
app.use("*", walletSession({ required: false }));

// Per-request structured logger bound with {requestId, method, path}.
// Routes read it as `c.var.log` and emit `route_error` / `route_ok` events.
app.use("*", async (c, next) => {
  const requestContext = c.get("requestContext") as RequestContext | undefined;
  const requestId =
    requestContext?.requestId ??
    (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `req_${Date.now()}`);
  const requestLogger = createStructuredLogger({
    requestId,
    method: c.req.method,
    path: c.req.path,
  });
  c.set("log", requestLogger);
  await next();
});

app.use("*", async (c, next) => {
  await next();
  const requestContext = c.get("requestContext");
  log.info(
    {
      requestId: requestContext?.requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: requestContext
        ? Math.round(performance.now() - requestContext.startTime)
        : undefined,
    },
    "request",
  );
});

// ───────────────────────── /health ─────────────────────────
// First route on the typed BFF pipe. Response schema is the contract
// the apps/web `hc<AppType>` client infers — adding/removing fields
// here changes the typed surface in apps/web. See HealthResponse below.
const HealthResponse = z
  .object({
    status: z.literal("ok"),
    uptime: z.number().describe("Process uptime in seconds"),
    version: z.string().describe("apps/api package version"),
  })
  .openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["meta"],
  summary: "Liveness probe",
  description:
    "Read by the Playwright e2e harness and by Railway's healthcheck. Body shape is part of the typed BFF contract; do not narrow without bumping consumers.",
  responses: {
    200: {
      content: { "application/json": { schema: HealthResponse } },
      description: "Service is up",
    },
  },
});

// `.openapi()` returns the same Hono instance with a refined type that
// includes the /health route in its route union. We capture that refined
// reference as `typedApp` so the bottom-of-file `AppType = typeof typedApp`
// surfaces the typed route to the apps/web `hc<AppType>` client.
//
// Non-OpenAPI `.use` / `.route` calls keep mutating `app` and continue to
// work at runtime (same instance) — they just don't appear in the typed
// client until they're also converted to `app.openapi(...)`.
// `marketsRoutes` is itself an OpenAPIHono now (wk1d2). We chain its
// `.route("/markets", marketsRoutes)` onto the typedApp capture so the
// markets endpoints (list / get / price / candles) propagate into AppType
// and the apps/web `hc<AppType>` client can call them with full request +
// response inference. Plain `app.route("/markets", marketsRoutes)` below
// still runs at runtime (same instance), but type refinement only flows
// through the captured chain.
const typedApp = app
  .openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok" as const,
        uptime: typeof process.uptime === "function" ? process.uptime() : 0,
        version: process.env.npm_package_version ?? "0.0.0",
      },
      200,
    ),
  )
  .route("/markets", marketsRoutes);

app.route("/liveblocks", liveblocksRoutes);
app.route("/markets", marketsRoutes);
app.route("/perps", perpsRoutes);
app.route("/spot", spotRoutes);
app.route("/fx-bento", fxBentoRoutes);
app.route("/fx-telarana", fxTelaranaRoutes);
app.route("/mcp", mcpRoutes);
app.route("/x402", x402Routes);
// Internal realtime publish route — guarded by X-Internal-Token. See
// `apps/api/src/routes/realtime.ts` for the envelope shape and
// `apps/api/src/lib/REALTIME.md` for the channel-naming convention.
app.route("/internal/realtime", realtimeRoutes);

// Webhook delivery surface (Wave H2). The store + delivery worker boot
// lazily on first mount; the worker subscribes to PR #56's Redis channels
// and fans out signed POSTs to registered integrator URLs. Skipped when
// `BUFI_WEBHOOK_DISABLED=1` so headless tests don't open a SQLite handle.
if (process.env.BUFI_WEBHOOK_DISABLED !== "1") {
  void bootWebhookSurface()
    .then(({ store, worker }) => {
      mountWebhookRoutes(app, { store, worker });
      log.info({ workerActive: Boolean(worker) }, "webhook.surface.mounted");
    })
    .catch((err) => {
      log.error({ err: (err as Error).message }, "webhook.surface.boot_failed");
    });
}

const port = Number(process.env.PORT ?? 3002);

app.onError(errorHandler as unknown as ErrorHandler);
app.notFound(notFoundHandler as unknown as NotFoundHandler);

// Bun's entry — uses `Bun.serve` semantics via `export default`.
//
// We wrap `app.fetch` so the WebSocket upgrade for `/ws/markets/:marketId`
// runs *before* Hono routing. Bun's `server.upgrade(req, { data })` returns
// `true` on a successful handshake (Bun has already sent the 101 response),
// in which case we MUST return `undefined`. All other paths fall through to
// the Hono app unchanged.
export default {
  port,
  // Bun's HTTP server defaults to a 10s idleTimeout. /fx-telarana/markets
  // can run up to ~18s end-to-end (listPools + per-pool marketIdOf/
  // isPoolLive + per-pool market(state), each bounded by withTimeout in
  // packages/fx-telarana/src/market-view.ts), so a slow Avalanche public
  // RPC was getting the socket cut from under the handler -- curl saw
  // HTTP 000 with 0 bytes at ~11s and the LoanTab rendered
  // "markets feed: Failed to fetch", which gated every Confirm CTA on
  // an unhydrated market.onchain. Bump to 60s so the worst-case hub
  // fallback path completes cleanly. Override via API_IDLE_TIMEOUT_S.
  idleTimeout: Number(process.env.API_IDLE_TIMEOUT_S ?? 60),
  fetch(
    req: Request,
    server: { upgrade: (req: Request, opts?: { data?: unknown }) => boolean },
  ) {
    const url = new URL(req.url);
    const marketId = parseMarketsWsPath(url.pathname);
    if (marketId) {
      const upgraded = server.upgrade(req, {
        data: makeUpgradeData({ marketId, log }),
      });
      if (upgraded) return undefined;
      return new Response("expected websocket upgrade", { status: 426 });
    }
    // Pass `process.env` as Hono's env so `c.env[envKey]` works under Bun.
    // worker-base (designed for Cloudflare Workers) reads CORS gating via
    // `c.env["NODE_ENV"]`; under CF the runtime binds env, under Bun we have
    // to hand it in.
    return app.fetch(req, process.env);
  },
  websocket: marketsWebSocketHandler,
};

log.info({ port }, "server.boot");

// Typed BFF surface for apps/web. `hc<AppType>(...)` in apps/web/lib/api-client.ts
// infers every typed route + response shape from this. Currently /health is the
// only fully-typed route (via `app.openapi(...)`); the result of that call is
// captured as `typedApp` above. Plain `.use` / `.route` calls don't refine
// `typeof app`, so additional routes (markets.ts is next, in a follow-up PR)
// must be added as `.openapi(...)` calls and chained / re-captured to extend
// the typed surface.
export type AppType = typeof typedApp;
