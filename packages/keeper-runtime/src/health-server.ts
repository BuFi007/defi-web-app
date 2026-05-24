// Minimal per-keeper HTTP server that exposes `/health`. Each keeper is a
// long-running Bun process that previously only logged to stdout; this gives
// the status page (and `apps/api/src/routes/keepers-health.ts`, which proxies
// the aggregate view) a real HTTP probe per keeper.
//
// `runKeeper` (./index.ts) calls `startHealthServer` once per process when
// the corresponding port env is set, and updates the tick-tracker (`lastTickAt`,
// `lastError`) from the tick loop. The server reads via `getStatus()` so the
// status snapshot is always live.

export interface HealthStatus {
  /** True when the latest tick succeeded recently enough; see `runKeeper`. */
  healthy: boolean;
  /** Unix epoch ms of the last successful tick. Undefined before the first tick. */
  lastTick?: number;
  /** Arbitrary per-keeper metadata merged into the JSON response. */
  meta?: Record<string, unknown>;
}

export interface HealthServerOptions {
  name: string;
  port: number;
  getStatus(): HealthStatus;
}

export function startHealthServer(opts: HealthServerOptions) {
  return Bun.serve({
    port: opts.port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        const status = opts.getStatus();
        const ageMs = status.lastTick ? Date.now() - status.lastTick : null;
        return Response.json(
          {
            name: opts.name,
            status: status.healthy ? "ok" : "degraded",
            lastTickAt: status.lastTick ?? null,
            ageMs,
            ...status.meta,
          },
          { status: status.healthy ? 200 : 503 },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// Returns the per-keeper health port from env, or null if unset. Honours both:
//   - `KEEPER_HEALTH_PORT` (generic, useful for one-keeper-per-host deploys)
//   - `KEEPER_<APP>_HEALTH_PORT` (e.g. KEEPER_PERPS_MATCHER_HEALTH_PORT) so
//     all 8 keepers can run side-by-side on one box during dev:complete
//
// `keeperName` is the runKeeper `def.name`, e.g. `@bufi/keeper-perps-matcher`.
// We strip `@bufi/` and `keeper-` and SHOUT_SNAKE_CASE the rest.
export function resolveHealthPort(keeperName: string): number | null {
  const slug = keeperName
    .replace(/^@bufi\//, "")
    .replace(/^keeper-/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
  const specific = process.env[`KEEPER_${slug}_HEALTH_PORT`];
  const generic = process.env.KEEPER_HEALTH_PORT;
  const raw = specific ?? generic;
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) return null;
  return port;
}
