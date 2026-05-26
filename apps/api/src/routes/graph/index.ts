/**
 * Public GraphQL gateway for the BUFX Envio HyperIndex.
 *
 * Forwards POST `/graph` to Envio's GraphQL endpoint (defaulting to the
 * hosted BUFX yield-engine endpoint) after running a per-IP / per-API-key
 * rate-limit and a coarse mutation guard. The gateway is read-only —
 * mutations are blocked at the boundary so the public API stays query-only.
 *
 * The schema endpoint (`GET /graph/schema`) introspects upstream once
 * and caches the result for `SCHEMA_CACHE_TTL_MS` so integrators can
 * codegen typed clients without burning ratelimit on the introspection
 * payload.
 */

import { Hono } from "hono";

import { rateLimit } from "../../middleware/rate-limit";
import { resolveRateLimit } from "../../middleware/rate-limit-config";

const graphRoutes = new Hono();

const SCHEMA_CACHE_TTL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

interface SchemaCacheEntry {
  body: string;
  fetchedAt: number;
}

let schemaCache: SchemaCacheEntry | null = null;

function envioGraphqlUrl(): string {
  return (
    process.env.ENVIO_GRAPHQL_URL ??
    process.env.ENVIO_URL ??
    process.env.PONDER_GRAPHQL_URL ??
    process.env.PONDER_URL ??
    "https://indexer.envio.dev/bufx-yield-engine/graphql"
  );
}

/**
 * Cheap mutation detector — strips comments + whitespace and looks for
 * a top-level `mutation` keyword. Avoids pulling in `graphql` as a dep
 * for v1; if integrators start sending nested-string `mutation`
 * payloads we'll swap in a real parser.
 *
 * `body` is the raw HTTP body (JSON or application/graphql). We try
 * to extract the `query` field when JSON; otherwise treat the whole
 * thing as the query.
 */
export function looksLikeMutation(body: string): boolean {
  let query: string | null = null;

  // Try JSON first — handles { query, variables, operationName }.
  try {
    const parsed = JSON.parse(body) as { query?: string };
    if (typeof parsed?.query === "string") query = parsed.query;
  } catch {
    // not JSON — treat raw body as GraphQL source
    query = body;
  }
  if (!query) return false;

  // Strip GraphQL line comments + redundant whitespace.
  const stripped = query
    .replace(/#[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  // A bare anonymous query starts with `{ ... }`. Operation keywords
  // are `query` / `mutation` / `subscription`. We only flag literal
  // mutations — a `query mutationLike { ... }` would slip through, but
  // that's safe because it's still a read.
  return /(^|\s)mutation\b/.test(stripped);
}

// ───────────────────────── rate limit ─────────────────────────

graphRoutes.use("*", async (c, next) => {
  const hasApiKey = Boolean(c.req.header("x-bufi-api-key"));
  const config = resolveRateLimit("graph", hasApiKey);
  // Re-build the middleware per-request so the tier picked here flows
  // into the limiter. Cheap (no allocation beyond a closure).
  const mw = rateLimit({
    ...config,
    onCheck: (snapshot) => {
      const log = c.get("log");
      // OTel hook (PR #57). Until @bufi/observability lands, surface
      // the remaining-bucket count on the per-request structured log so
      // we still get a tail signal on integrators approaching limits.
      log?.info?.("rate_limit.check", {
        bucket: snapshot.routeKey,
        remaining: snapshot.remaining,
        capacity: snapshot.capacity,
        allowed: snapshot.allowed,
      });
    },
  });
  return mw(c, next);
});

// ───────────────────────── POST /graph ─────────────────────────

graphRoutes.post("/", async (c) => {
  const body = await c.req.text();

  if (looksLikeMutation(body)) {
    return c.json(
      {
        error: "mutations_not_allowed_on_public_gateway",
        hint: "The public GraphQL gateway is read-only. Mutations are blocked at the perimeter.",
      },
      405,
    );
  }

  const url = envioGraphqlUrl();
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": c.req.header("content-type") ?? "application/json",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const log = c.get("log");
    log?.warn?.("graph.upstream_unreachable", {
      err: (err as Error).message,
      url,
    });
    return c.json(
      {
        error: "upstream_unavailable",
        hint: "GraphQL indexer (Envio) is not reachable.",
      },
      502,
    );
  }

  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  // Pass through body verbatim; pin a short cache so identical reads
  // from a busy dashboard ride the CDN/edge instead of hammering Envio.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=2, stale-while-revalidate=10",
      "X-Bufi-Gateway": "envio-v1",
    },
  });
});

// ───────────────────────── GET /graph/schema ─────────────────────────

graphRoutes.get("/schema", async (c) => {
  const now = Date.now();
  if (schemaCache && now - schemaCache.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return new Response(schemaCache.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Bufi-Gateway": "envio-v1",
        "X-Bufi-Schema-Cache": "hit",
      },
    });
  }

  const introspection = {
    query: `query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types {
          kind
          name
          description
          fields { name description type { kind name ofType { kind name } } }
          inputFields { name type { kind name ofType { kind name } } }
          interfaces { name }
          enumValues { name description }
          possibleTypes { name }
        }
      }
    }`,
  };

  try {
    const upstream = await fetch(envioGraphqlUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(introspection),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    if (upstream.ok) {
      schemaCache = { body: text, fetchedAt: now };
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Bufi-Gateway": "envio-v1",
        "X-Bufi-Schema-Cache": "miss",
      },
    });
  } catch (err) {
    const log = c.get("log");
    log?.warn?.("graph.schema_upstream_unreachable", {
      err: (err as Error).message,
    });
    return c.json({ error: "upstream_unavailable" }, 502);
  }
});

export { graphRoutes };
