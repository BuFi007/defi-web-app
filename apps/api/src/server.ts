import { Hono } from "hono";
import type { ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import { createLogger } from "@bufinance/logger";
import {
  createCorsMiddleware,
  errorHandler,
  notFoundHandler,
  requestContext,
  type RequestContext,
} from "@bufinance/worker-base";

import { fxBentoRoutes } from "./routes/fx-bento";
import { fxTelaranaRoutes } from "./routes/fx-telarana";
import { liveblocksRoutes } from "./routes/liveblocks";
import { marketsRoutes } from "./routes/markets";
import { mcpRoutes } from "./routes/mcp";
import { perpsRoutes } from "./routes/perps";
import { spotRoutes } from "./routes/spot";
import { x402Routes } from "./routes/x402";
import { walletSession } from "./wallet-session";

declare module "hono" {
  interface ContextVariableMap {
    requestContext: RequestContext;
    requestId: string;
  }
}

const app = new Hono();
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
      "X-Wallet-Signature",
      "Payment-Signature",
    ],
    exposeHeaders: ["X-Request-Id", "X-Response-Time"],
    maxAge: 600,
    credentials: true,
  },
}) as unknown as MiddlewareHandler;
const requestContextMiddleware =
  requestContext as unknown as () => MiddlewareHandler;

app.use("*", requestContextMiddleware());
app.use("*", corsMiddleware);
app.use("*", walletSession({ required: false }));

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

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/liveblocks", liveblocksRoutes);
app.route("/markets", marketsRoutes);
app.route("/perps", perpsRoutes);
app.route("/spot", spotRoutes);
app.route("/fx-bento", fxBentoRoutes);
app.route("/fx-telarana", fxTelaranaRoutes);
app.route("/mcp", mcpRoutes);
app.route("/x402", x402Routes);

const port = Number(process.env.PORT ?? 3002);

app.onError(errorHandler as unknown as ErrorHandler);
app.notFound(notFoundHandler as unknown as NotFoundHandler);

// Bun's entry — uses `Bun.serve` semantics via `export default`.
export default {
  port,
  fetch: app.fetch,
};

log.info({ port }, "server.boot");
