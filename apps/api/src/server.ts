import { Hono } from "hono";

import { fxBentoRoutes } from "./routes/fx-bento";
import { fxTelaranaRoutes } from "./routes/fx-telarana";
import { liveblocksRoutes } from "./routes/liveblocks";
import { marketsRoutes } from "./routes/markets";
import { mcpRoutes } from "./routes/mcp";
import { perpsRoutes } from "./routes/perps";
import { x402Routes } from "./routes/x402";
import { createLogger } from "./logger";
import { walletSession } from "./wallet-session";

const app = new Hono();
const log = createLogger({ app: "@bufi/api" });

app.use("*", walletSession({ required: false }));

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  log.info("request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  });
});

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/liveblocks", liveblocksRoutes);
app.route("/markets", marketsRoutes);
app.route("/perps", perpsRoutes);
app.route("/fx-bento", fxBentoRoutes);
app.route("/fx-telarana", fxTelaranaRoutes);
app.route("/mcp", mcpRoutes);
app.route("/x402", x402Routes);

const port = Number(process.env.PORT ?? 3002);

// Bun's entry — uses `Bun.serve` semantics via `export default`.
export default {
  port,
  fetch: app.fetch,
};

log.info("server.boot", { port });
