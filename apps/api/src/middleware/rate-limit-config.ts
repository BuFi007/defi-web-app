/**
 * Per-route + per-tier rate-limit defaults.
 *
 * The shape is intentionally small: each route has an `anon` bucket
 * (IP-only callers) and an optional `tier1` bucket (X-Bufi-Api-Key
 * callers). When a request carries an API key, the tier1 config wins;
 * otherwise the anon config applies.
 *
 * Numbers below are starting points, not load-tested ceilings. The
 * intent is *conservative* for anon to push integrators toward
 * authenticated calls, *generous* for tier1 so legitimate codegen +
 * polling clients don't hit the wall.
 */

import type { RateLimitConfig } from "./rate-limit";

export interface RateLimitTier {
  bucketCapacity: number;
  refillPerSecond: number;
}

export interface RateLimitRouteConfig {
  /** Bucket used when no API key is present (IP-keyed). */
  anon: RateLimitTier;
  /** Bucket used when X-Bufi-Api-Key is present. */
  tier1?: RateLimitTier;
  /** Logical bucket grouping — multiple routes can share quota. */
  routeKey: string;
}

export const RATE_LIMITS: Record<string, RateLimitRouteConfig> = {
  /** Public GraphQL gateway — heaviest read surface, lowest anon ceiling. */
  graph: {
    routeKey: "graph",
    anon: { bucketCapacity: 100, refillPerSecond: 10 },
    tier1: { bucketCapacity: 1000, refillPerSecond: 100 },
  },
  /** Markets read endpoints — cheap reads, higher ceiling. */
  markets: {
    routeKey: "markets",
    anon: { bucketCapacity: 200, refillPerSecond: 50 },
    tier1: { bucketCapacity: 2000, refillPerSecond: 500 },
  },
  /** Perps read endpoints — same tier as markets for the public read paths. */
  perps: {
    routeKey: "perps",
    anon: { bucketCapacity: 200, refillPerSecond: 50 },
    tier1: { bucketCapacity: 2000, refillPerSecond: 500 },
  },
};

/**
 * Resolve the active tier for a request. Returns the `RateLimitConfig`
 * that should be handed to `rateLimit(...)`.
 *
 * When `hasApiKey` is true and a `tier1` bucket exists, use it;
 * otherwise fall back to `anon`. The `routeKey` is preserved so anon
 * and tier1 callers contend for the same logical bucket only when the
 * config explicitly says so (today they don't — each tier gets its
 * own slot in the store because the key extractor returns
 * `key:<prefix>` vs `ip:<addr>`).
 */
export function resolveRateLimit(
  route: keyof typeof RATE_LIMITS,
  hasApiKey: boolean,
): RateLimitConfig {
  const cfg = RATE_LIMITS[route];
  if (!cfg) throw new Error(`unknown rate-limit route: ${String(route)}`);
  const tier = hasApiKey && cfg.tier1 ? cfg.tier1 : cfg.anon;
  return {
    bucketCapacity: tier.bucketCapacity,
    refillPerSecond: tier.refillPerSecond,
    routeKey: cfg.routeKey,
  };
}
