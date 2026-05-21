/**
 * B2B API-key middleware (Wave K4 / PR-H5).
 *
 * Distinguishes two integrator roles on the spot surface:
 *
 *   - `market-taker`  — read-only / quote / fill. Anonymous by default;
 *                       a configured taker key just upgrades observability
 *                       (rate-limit accounting, request logging).
 *   - `market-setter` — LP add/remove liquidity, pool admin. Hard-required
 *                       on every mutating LP endpoint via `requireRole(...)`.
 *
 * Transport: a single `X-API-Key` header. The middleware looks the value
 * up in an in-memory map seeded from env at module load:
 *
 *   MARKET_SETTER_API_KEYS — comma-separated; any key here grants the
 *                            `market-setter` role. Required if you want any
 *                            integrator to call the LP endpoints.
 *   MARKET_TAKER_API_KEYS  — comma-separated; optional. Takers default to
 *                            anon (`null` role) when no key is configured.
 *
 * In-memory shape documented for the Redis-backed production follow-up
 * (`api_key_registry` hash, `{ keyHash → { role, label, createdAt } }`):
 *
 *   apiKeyRoles: Map<string /* api-key plaintext * /, ApiKeyRole>
 *
 * The plaintext-keyed map is fine for the dev / single-instance shape we
 * ship today. Production: SHA-256 the header value, key the Redis hash by
 * digest, and add a `label` + rotation timestamp per row so we can revoke
 * a single integrator without a full env restart.
 *
 * Bearer-token / OAuth variants are explicitly out of scope — every B2B
 * integrator we have today rotates a header key out of band.
 */

import type { Context, MiddlewareHandler } from "hono";

export type ApiKeyRole = "market-taker" | "market-setter";

declare module "hono" {
  interface ContextVariableMap {
    apiKeyRole: ApiKeyRole | null;
  }
}

const HEADER_NAME = "X-API-Key";

interface ApiKeyRegistry {
  /** Plaintext key → role. Lower-case the keys is *not* done — keys are
   *  treated as case-sensitive opaque strings. */
  keys: Map<string, ApiKeyRole>;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Build the in-memory key registry from env. Exported for tests so the
 * harness can stub a fresh registry per case without mutating
 * `process.env`.
 */
export function buildApiKeyRegistryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApiKeyRegistry {
  const keys = new Map<string, ApiKeyRole>();
  // Setters take priority over takers if a key is (mis)configured in
  // both lists — least-privilege would be the opposite, but the more
  // useful failure mode for an integrator is "I see my role escalated
  // and call the right endpoints" rather than "I silently downgrade
  // and get 401 on every LP call".
  for (const key of parseCsv(env.MARKET_TAKER_API_KEYS)) {
    keys.set(key, "market-taker");
  }
  for (const key of parseCsv(env.MARKET_SETTER_API_KEYS)) {
    keys.set(key, "market-setter");
  }
  return { keys };
}

// Module-level singleton. Re-built once at boot from `process.env`.
// Tests that need a different registry must call `setApiKeyRegistry(...)`.
let registry: ApiKeyRegistry = buildApiKeyRegistryFromEnv();

/** Test-only hook. Swaps the in-memory registry. */
export function setApiKeyRegistry(next: ApiKeyRegistry): void {
  registry = next;
}

/** Read the current registry (test introspection). */
export function getApiKeyRegistry(): ApiKeyRegistry {
  return registry;
}

/**
 * Resolve the role for a header value. Exported so callers (e.g. tests,
 * future health endpoints) can probe a key without binding to a Hono
 * request.
 */
export function resolveApiKeyRole(header: string | null | undefined): ApiKeyRole | null {
  if (!header) return null;
  return registry.keys.get(header) ?? null;
}

/**
 * Global middleware. Runs on every request; reads `X-API-Key` and stows
 * the resolved role on `c.set("apiKeyRole", ...)`. Never short-circuits
 * the request — `requireRole(...)` is the gate.
 *
 * Mount once near the top of the pipe (after request-context, before any
 * route that calls `requireRole`).
 */
export function apiKey(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header(HEADER_NAME) ?? c.req.header(HEADER_NAME.toLowerCase());
    c.set("apiKeyRole", resolveApiKeyRole(header));
    await next();
  };
}

/**
 * Route-level guard. Returns 401 unless the request's resolved role
 * matches `role`. Used on POST/DELETE `/spot/pools/...` so only
 * market-setter integrators can mutate LP state.
 *
 * Note: this *only* checks the api-key role. Wallet-session is still
 * read separately on the route — LP mutations need both an authorized
 * B2B key AND a signed wallet session if the integrator is acting on
 * behalf of an EOA. Today the LP endpoints are scaffolded (intent only;
 * on-chain settlement lands in a follow-up), so the wallet-session is
 * not yet required there.
 */
export function requireRole(role: ApiKeyRole): MiddlewareHandler {
  return async (c, next) => {
    const have = c.get("apiKeyRole");
    if (have !== role) {
      return c.json(
        {
          error: "api_key_role_required",
          required: role,
          have: have ?? "anon",
        },
        401,
      );
    }
    await next();
  };
}

/** Test introspection — header name we read off the request. */
export const API_KEY_HEADER = HEADER_NAME;
