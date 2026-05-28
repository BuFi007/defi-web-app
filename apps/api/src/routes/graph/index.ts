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
const ENVIO_GRAPHQL_FALLBACK_URLS = [
  "https://indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql",
] as const;
const ENVIO_LIST_ENTITIES = [
  "ArcadePlacement",
  "ArcadeRoom",
  "ArcadeRound",
  "ArcadeSettlement",
  "BufxRequest",
  "DailyMarketSnapshot",
  "FundingEvent",
  "HedgeExposure",
  "HedgeRebalance",
  "LendingEvent",
  "PerpTrade",
  "PerpsOrderCancellation",
  "PerpsPosition",
  "PositionChange",
  "SpotSwap",
  "TelaranaDeposit",
  "TelaranaGatewayContext",
  "TelaranaLoan",
  "TelaranaMarket",
  "TelaranaOracleConfig",
  "TradingFeeRoute",
  "TurboFeeVaultEvent",
] as const;

interface SchemaCacheEntry {
  body: string;
  fetchedAt: number;
}

interface GraphqlCompatBody {
  body: string;
  wrappedEntities: Set<string>;
}

let schemaCache: SchemaCacheEntry | null = null;

function envioGraphqlUrls(): string[] {
  const candidates = [
    process.env.ENVIO_GRAPHQL_URL,
    process.env.ENVIO_URL,
    process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL,
    process.env.NEXT_PUBLIC_ENVIO_URL,
    process.env.PONDER_GRAPHQL_URL,
    process.env.PONDER_URL,
    ...ENVIO_GRAPHQL_FALLBACK_URLS,
  ].filter((url): url is string => Boolean(url));

  return [...new Set(candidates)];
}

function allowEmptyYieldFallback(): boolean {
  if (process.env.ENVIO_EMPTY_YIELD_FALLBACK === "1") return true;
  if (process.env.ENVIO_EMPTY_YIELD_FALLBACK === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function graphqlSource(body: string): string {
  try {
    const parsed = JSON.parse(body) as { query?: string };
    if (typeof parsed?.query === "string") return parsed.query;
  } catch {
    // not JSON — treat raw body as GraphQL source
  }
  return body;
}

function rewritePonderConnectionItems(body: string): GraphqlCompatBody {
  let parsed: { query?: string; variables?: unknown } | null = null;
  try {
    parsed = JSON.parse(body) as { query?: string; variables?: unknown };
  } catch {
    parsed = null;
  }

  const query = typeof parsed?.query === "string" ? parsed.query : body;
  const wrappedEntities = new Set<string>();
  const entityAlternation = ENVIO_LIST_ENTITIES.join("|");
  const connectionPattern = new RegExp(
    `\\b(${entityAlternation})(\\s*\\([^{}]*\\))?\\s*\\{\\s*items\\s*\\{([\\s\\S]*?)\\}\\s*\\}`,
    "g",
  );
  const rewrittenQuery = query.replace(
    connectionPattern,
    (_match, entity: string, args: string | undefined, selection: string) => {
      wrappedEntities.add(entity);
      return `${entity}${args ?? ""} { ${selection} }`;
    },
  );

  if (wrappedEntities.size === 0) return { body, wrappedEntities };
  if (parsed) {
    return {
      body: JSON.stringify({ ...parsed, query: rewrittenQuery }),
      wrappedEntities,
    };
  }
  return { body: rewrittenQuery, wrappedEntities };
}

function wrapPonderConnectionItems(
  text: string,
  wrappedEntities: Set<string>,
): string {
  if (wrappedEntities.size === 0) return text;
  try {
    const payload = JSON.parse(text) as { data?: Record<string, unknown> };
    if (!payload?.data || typeof payload.data !== "object") return text;
    for (const entity of wrappedEntities) {
      const value = payload.data[entity];
      if (Array.isArray(value)) {
        payload.data[entity] = { items: value };
      }
    }
    return JSON.stringify(payload);
  } catch {
    return text;
  }
}

function looksLikeDailyMarketSnapshotQuery(body: string): boolean {
  return /\bDailyMarketSnapshot\b/.test(graphqlSource(body));
}

function emptyDailyMarketSnapshotResponse(wrapItems = false): Response {
  return new Response(
    JSON.stringify({
      data: {
        DailyMarketSnapshot: wrapItems ? { items: [] } : [],
      },
    }),
    {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=2, stale-while-revalidate=10",
      "X-Bufi-Gateway": "envio-v1",
      "X-Bufi-Gateway-Fallback": "empty-daily-market-snapshot",
    },
    },
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
  const query = graphqlSource(body);
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
  const compat = rewritePonderConnectionItems(body);

  if (looksLikeMutation(body)) {
    return c.json(
      {
        error: "mutations_not_allowed_on_public_gateway",
        hint: "The public GraphQL gateway is read-only. Mutations are blocked at the perimeter.",
      },
      405,
    );
  }

  const log = c.get("log");
  let upstream: Response | null = null;
  let upstreamUrl = "";
  let lastError: Error | null = null;

  for (const url of envioGraphqlUrls()) {
    try {
      const candidate = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": c.req.header("content-type") ?? "application/json",
          Accept: "application/json",
        },
        body: compat.body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (candidate.status === 404) {
        void candidate.body?.cancel();
        log?.warn?.("graph.upstream_not_found", { url });
        continue;
      }

      upstream = candidate;
      upstreamUrl = url;
      break;
    } catch (err) {
      lastError = err as Error;
      log?.warn?.("graph.upstream_unreachable", {
        err: lastError.message,
        url,
      });
    }
  }

  if (!upstream) {
    if (allowEmptyYieldFallback() && looksLikeDailyMarketSnapshotQuery(body)) {
      return emptyDailyMarketSnapshotResponse(
        compat.wrappedEntities.has("DailyMarketSnapshot"),
      );
    }
    return c.json(
      {
        error: "upstream_unavailable",
        hint: "GraphQL indexer (Envio) is not reachable.",
        detail: lastError?.message ?? "all configured Envio endpoints returned 404",
      },
      502,
    );
  }

  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  if (
    allowEmptyYieldFallback() &&
    (upstream.status === 404 || upstream.status >= 500) &&
    looksLikeDailyMarketSnapshotQuery(body)
  ) {
    void upstream.body?.cancel();
    return emptyDailyMarketSnapshotResponse(
      compat.wrappedEntities.has("DailyMarketSnapshot"),
    );
  }

  const text = await upstream.text();
  const responseText = wrapPonderConnectionItems(text, compat.wrappedEntities);

  // Pass through body verbatim; pin a short cache so identical reads
  // from a busy dashboard ride the CDN/edge instead of hammering Envio.
  return new Response(responseText, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=2, stale-while-revalidate=10",
      "X-Bufi-Gateway": "envio-v1",
      "X-Bufi-Envio-Url": upstreamUrl,
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
    let upstream: Response | null = null;
    let upstreamUrl = "";
    for (const url of envioGraphqlUrls()) {
      const candidate = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(introspection),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (candidate.status === 404) {
        void candidate.body?.cancel();
        continue;
      }
      upstream = candidate;
      upstreamUrl = url;
      break;
    }

    if (!upstream) {
      return c.json({ error: "upstream_unavailable" }, 502);
    }

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
        "X-Bufi-Envio-Url": upstreamUrl,
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
