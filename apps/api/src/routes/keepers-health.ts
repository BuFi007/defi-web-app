// Aggregate /keepers route — fans out to each registered keeper's /health
// HTTP server (mounted by packages/keeper-runtime/src/health-server.ts) and
// returns a normalised summary. The status page consumes this single
// endpoint so it doesn't need to know per-keeper hostnames.
//
// Per-keeper URLs are read from env at request time so a deploy can rotate
// hostnames without restarting the API:
//
//   KEEPER_HEALTH_URLS = "matcher=http://10.0.0.5:9101,funding=http://10.0.0.6:9102"
//
// Or per-keeper overrides for the canonical slugs:
//
//   KEEPER_HEALTH_URL_PERPS_MATCHER  = "http://10.0.0.5:9101"
//   KEEPER_HEALTH_URL_PERPS_FUNDING  = "http://10.0.0.6:9102"
//   ...
//
// If neither is set, the aggregator returns an empty list rather than 500ing
// — local dev (no infra) and unit tests should still hit `/keepers` cleanly.
//
// Each upstream probe has a short timeout (KEEPER_HEALTH_FETCH_TIMEOUT_MS,
// default 1500ms) so one wedged keeper can't stall the aggregate view.

import { Hono } from "hono";

const KEEPER_HEALTH_TIMEOUT_MS = Number(
  process.env.KEEPER_HEALTH_FETCH_TIMEOUT_MS ?? 1_500,
);

// The canonical slugs we expect under `KEEPER_HEALTH_URL_<SLUG>`. Order
// here drives the response order so the status page renders deterministically.
const DEFAULT_KEEPER_SLUGS = [
  "gateway_signer",
  "spot",
  "perps_matcher",
  "perps_liquidator",
  "perps_funding",
  "pyth",
  "arcade_settler",
  "perps_replacement_agent",
] as const;

interface KeeperTarget {
  name: string;
  url: string;
}

interface KeeperHealth {
  name: string;
  status: "ok" | "degraded" | "unreachable";
  url: string;
  ageMs: number | null;
  lastTickAt: number | null;
  lastError?: string;
  httpStatus?: number;
  fetchError?: string;
  /** Verbatim extra meta fields the keeper attached (app, pollMs, etc.). */
  meta?: Record<string, unknown>;
}

// Parse KEEPER_HEALTH_URLS=foo=http://...,bar=http://... into target list.
function parseUrlList(raw: string | undefined): KeeperTarget[] {
  if (!raw) return [];
  const out: KeeperTarget[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const url = trimmed.slice(eq + 1).trim();
    if (!name || !url) continue;
    out.push({ name, url });
  }
  return out;
}

function discoverTargets(): KeeperTarget[] {
  const targets = new Map<string, string>();

  for (const { name, url } of parseUrlList(process.env.KEEPER_HEALTH_URLS)) {
    targets.set(name, url);
  }

  for (const slug of DEFAULT_KEEPER_SLUGS) {
    const envKey = `KEEPER_HEALTH_URL_${slug.toUpperCase()}`;
    const url = process.env[envKey];
    if (url) targets.set(slug, url);
  }

  return [...targets.entries()].map(([name, url]) => ({ name, url }));
}

async function probe(target: KeeperTarget): Promise<KeeperHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KEEPER_HEALTH_TIMEOUT_MS);
  const healthUrl = target.url.replace(/\/$/, "") + "/health";
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON body still counts as reachable; we just won't have meta.
    }
    const rawStatus = typeof body.status === "string" ? body.status : null;
    const status: KeeperHealth["status"] =
      rawStatus === "ok" || rawStatus === "degraded"
        ? rawStatus
        : res.ok
          ? "ok"
          : "degraded";
    const { name: _name, status: _status, lastTickAt, ageMs, lastError, ...meta } = body as {
      name?: unknown;
      status?: unknown;
      lastTickAt?: unknown;
      ageMs?: unknown;
      lastError?: unknown;
    };
    return {
      name: target.name,
      status,
      url: target.url,
      httpStatus: res.status,
      lastTickAt: typeof lastTickAt === "number" ? lastTickAt : null,
      ageMs: typeof ageMs === "number" ? ageMs : null,
      ...(typeof lastError === "string" ? { lastError } : {}),
      meta: meta as Record<string, unknown>,
    };
  } catch (e) {
    return {
      name: target.name,
      status: "unreachable",
      url: target.url,
      lastTickAt: null,
      ageMs: null,
      fetchError: (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const keepersHealthRoutes = new Hono();

keepersHealthRoutes.get("/", async (c) => {
  const targets = discoverTargets();
  if (targets.length === 0) {
    return c.json({ keepers: [], targets: 0 });
  }
  const results = await Promise.all(targets.map(probe));
  const allHealthy = results.every((r) => r.status === "ok");
  c.status(allHealthy ? 200 : 207);
  return c.json({ keepers: results, targets: results.length });
});

keepersHealthRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  const target = discoverTargets().find((t) => t.name === name);
  if (!target) return c.json({ error: `keeper not registered: ${name}` }, 404);
  const result = await probe(target);
  return c.json(result, result.status === "ok" ? 200 : 503);
});
