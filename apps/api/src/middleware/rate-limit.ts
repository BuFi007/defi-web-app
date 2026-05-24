/**
 * Token-bucket rate limiter for public-facing routes (Wave I3).
 *
 * Each request resolves to a *key* — either the API-key prefix (when
 * `x-bufi-api-key: <prefix>.<secret>` is present) or the client IP.
 * Each (key, route) pair owns its own token bucket; consumed tokens
 * refill linearly at `refillPerSecond` up to `bucketCapacity`. When the
 * bucket is empty we return 429 with a `Retry-After` header derived
 * from the configured refill rate.
 *
 * Storage backend selection is intentionally lazy:
 *   - REDIS_URL set → call into `ioredis` lazily so the package only
 *     loads when actually configured. Multi-instance prod safe.
 *   - Otherwise → in-process Map with TTL eviction. Single-instance
 *     dev only; sibling Hono workers won't share the bucket.
 *
 * The middleware is transparent on the fast path: when a request is
 * allowed, the only work is two arithmetic ops + one Map lookup (or
 * one Redis call), so it can sit on every public route without
 * meaningful per-request overhead.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitConfig {
  /** Maximum tokens the bucket can hold — burst ceiling. */
  bucketCapacity: number;
  /** Tokens added per second — sustained rate. */
  refillPerSecond: number;
  /**
   * Logical bucket name. When multiple middleware instances share a
   * `routeKey`, they share quota — useful for grouping `/graph` +
   * `/graph/schema` under one limit. Defaults to the request path.
   */
  routeKey?: string;
  /**
   * Override the key extractor (defaults to API-key prefix → IP).
   * Tests inject a stable key so they don't have to fake the request.
   */
  keyExtractor?: (c: Context) => string;
  /**
   * Hook called on every check with the post-consume snapshot, even
   * when the request was rejected. Wired up in `server.ts` so OTel
   * can emit `rate_limit.bucket_remaining` without leaking spans into
   * this module's import graph.
   */
  onCheck?: (snapshot: RateLimitSnapshot) => void;
}

export interface RateLimitSnapshot {
  key: string;
  routeKey: string;
  allowed: boolean;
  remaining: number;
  capacity: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  /**
   * Atomically attempt to consume one token. Returns the updated
   * remaining-tokens count and the seconds the caller should wait
   * if the request was rejected.
   */
  consume(
    key: string,
    routeKey: string,
    config: RateLimitConfig,
    now: number,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>;
}

// ───────────────────────── store: in-memory ─────────────────────────

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/**
 * Default single-process store. Keeps an in-memory Map keyed by
 * `${key}|${routeKey}`. The Map grows unboundedly only in the worst
 * case; we sweep buckets idle for > 10 minutes on every consume so
 * the working set stays bounded.
 */
export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, BucketState>();
  const IDLE_TTL_MS = 10 * 60 * 1000;

  function sweep(now: number) {
    if (buckets.size < 1024) return;
    for (const [k, b] of buckets) {
      if (now - b.updatedAt > IDLE_TTL_MS) buckets.delete(k);
    }
  }

  return {
    async consume(key, routeKey, config, now) {
      sweep(now);
      const bucketKey = `${key}|${routeKey}`;
      const existing = buckets.get(bucketKey);
      const elapsedSeconds = existing
        ? Math.max(0, (now - existing.updatedAt) / 1000)
        : 0;
      const refilled = existing
        ? Math.min(
            config.bucketCapacity,
            existing.tokens + elapsedSeconds * config.refillPerSecond,
          )
        : config.bucketCapacity;

      if (refilled < 1) {
        buckets.set(bucketKey, { tokens: refilled, updatedAt: now });
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((1 - refilled) / config.refillPerSecond),
        );
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      const remaining = refilled - 1;
      buckets.set(bucketKey, { tokens: remaining, updatedAt: now });
      return { allowed: true, remaining, retryAfterSeconds: 0 };
    },
  };
}

// ───────────────────────── store: redis ─────────────────────────

type RedisLike = {
  eval: (
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ) => Promise<unknown>;
};

/**
 * Lua script — atomic token-bucket. We round token counts to four
 * decimals (× 10_000) so we can store them as integer cents-of-tokens
 * in Redis without floating-point drift. Returns
 * `{ allowed, remaining * 10000, retryAfterSeconds }`.
 */
const BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(data[1])
local updatedAt = tonumber(data[2])

if tokens == nil then
  tokens = capacity * 10000
  updatedAt = now
end

local elapsed = math.max(0, (now - updatedAt) / 1000)
local refilled = math.min(capacity * 10000, tokens + elapsed * refill * 10000)

if refilled < 10000 then
  redis.call('HMSET', key, 'tokens', refilled, 'updatedAt', now)
  redis.call('EXPIRE', key, 600)
  local retry = math.max(1, math.ceil((10000 - refilled) / (refill * 10000)))
  return {0, math.floor(refilled), retry}
end

local remaining = refilled - 10000
redis.call('HMSET', key, 'tokens', remaining, 'updatedAt', now)
redis.call('EXPIRE', key, 600)
return {1, math.floor(remaining), 0}
`;

export function createRedisRateLimitStore(redis: RedisLike): RateLimitStore {
  return {
    async consume(key, routeKey, config, now) {
      const bucketKey = `bufi:ratelimit:${routeKey}:${key}`;
      const result = (await redis.eval(
        BUCKET_LUA,
        1,
        bucketKey,
        config.bucketCapacity,
        config.refillPerSecond,
        now,
      )) as [number, number, number];
      return {
        allowed: result[0] === 1,
        remaining: result[1] / 10000,
        retryAfterSeconds: result[2],
      };
    },
  };
}

// ───────────────────────── store: default selection ─────────────────────────

let defaultStorePromise: Promise<RateLimitStore> | null = null;

/**
 * Lazy default store. Resolves to a Redis-backed store when REDIS_URL
 * is set and `ioredis` is installed; otherwise the in-memory store.
 *
 * The Redis import is dynamic so single-instance dev environments
 * don't need `ioredis` in their `node_modules` to boot the API.
 */
export function getDefaultRateLimitStore(): Promise<RateLimitStore> {
  if (!defaultStorePromise) {
    defaultStorePromise = (async () => {
      const url = process.env.REDIS_URL ?? process.env.BUFI_REDIS_URL;
      if (!url) return createMemoryRateLimitStore();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import(/* @vite-ignore */ "ioredis").catch(
          () => null,
        );
        if (!mod) return createMemoryRateLimitStore();
        const Redis = mod.default ?? mod.Redis ?? mod;
        const client = new Redis(url, { lazyConnect: false });
        return createRedisRateLimitStore(client);
      } catch {
        return createMemoryRateLimitStore();
      }
    })();
  }
  return defaultStorePromise;
}

/** Test/override hook — wipe cached default store. */
export function __resetDefaultRateLimitStore(): void {
  defaultStorePromise = null;
}

// ───────────────────────── key extraction ─────────────────────────

/**
 * Resolve the client IP. Tries the standard forwarded-for chain first,
 * falls back to Bun's `c.env.ip` when present, then `"unknown"` so an
 * absent IP can't be used to bypass the bucket by becoming the empty
 * string.
 */
export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real;
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;
  return "ip:unknown";
}

/**
 * Default key: API-key prefix when present, otherwise IP. The API key
 * is expected as `<prefix>.<secret>` so we only ever store/log the
 * prefix — the secret stays opaque.
 */
function defaultKey(c: Context): string {
  const apiKey = c.req.header("x-bufi-api-key");
  if (apiKey) {
    const prefix = apiKey.split(".")[0];
    if (prefix && prefix.length > 0) return `key:${prefix}`;
  }
  return `ip:${clientIp(c)}`;
}

// ───────────────────────── middleware factory ─────────────────────────

export interface RateLimitFactoryOptions {
  /** Override the store. Defaults to `getDefaultRateLimitStore()`. */
  store?: RateLimitStore;
}

/**
 * Build a rate-limit middleware. Stores can be passed in or resolved
 * lazily — the latter is the common case in `server.ts`.
 */
export function rateLimit(
  config: RateLimitConfig,
  options: RateLimitFactoryOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    const key = config.keyExtractor ? config.keyExtractor(c) : defaultKey(c);
    const routeKey = config.routeKey ?? c.req.path;
    const store = options.store ?? (await getDefaultRateLimitStore());
    const now = Date.now();
    const result = await store.consume(key, routeKey, config, now);

    config.onCheck?.({
      key,
      routeKey,
      allowed: result.allowed,
      remaining: result.remaining,
      capacity: config.bucketCapacity,
      retryAfterSeconds: result.retryAfterSeconds,
    });

    c.header("X-RateLimit-Limit", String(config.bucketCapacity));
    c.header("X-RateLimit-Remaining", String(Math.floor(result.remaining)));

    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json(
        {
          error: "rate_limited",
          retryAfter: result.retryAfterSeconds,
          bucket: routeKey,
        },
        429,
      );
    }

    await next();
  };
}
