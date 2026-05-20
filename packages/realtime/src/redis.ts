/**
 * Redis pub/sub abstraction for the BUFI realtime fan-out.
 *
 * Originally landed in `apps/api/src/lib/redis.ts` (Wave E6, PR #56).
 * Extracted into `@bufi/realtime` so non-api callers (matcher, future
 * keepers, ponder bridge) can publish/subscribe without depending on the
 * api workspace. apps/api re-exports from here verbatim — Wave H1.
 *
 * One process can be both a publisher and a subscriber, but the Redis
 * protocol forbids issuing non-subscribe commands on a connection that's
 * already in SUBSCRIBE mode. We therefore lazily open *two* connections:
 *
 *   - `publisher`  : carries PUBLISH + ad-hoc commands
 *   - `subscriber` : permanently in SUBSCRIBE mode, dispatches to handlers
 *
 * When `REDIS_URL` is not set we route both `publishChannel` and
 * `subscribeChannel` through an in-process `EventEmitter`. That keeps the
 * single-instance dev experience working — the WS scaffold doesn't go
 * silent just because a developer hasn't booted a local Redis.
 *
 * The fallback is *deliberately not multi-instance safe* (the whole point
 * of Redis is cross-instance fan-out). A boot-time log warns once so this
 * isn't a silent foot-gun in staging. Specifically: matcher and api in
 * SEPARATE Bun processes will NOT see each other through the emitter —
 * REDIS_URL is required for cross-process notify (matcher-intent-inserted).
 */

import { EventEmitter } from "node:events";

import { createLogger } from "@bufinance/logger";

import type Redis from "ioredis";

const log = createLogger({ prefix: "bufx-realtime-redis" });

// ---------- module state ----------

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let fallbackEmitter: EventEmitter | null = null;
let didWarnNoRedis = false;
// Channels we've subscribed `subscriber` to. Mapping channel -> Set of local
// callbacks. Redis only fires the connection-level `message` event once per
// channel, so we demux to N JS subscribers ourselves.
const channelHandlers = new Map<string, Set<MessageHandler>>();

type MessageHandler = (payload: unknown) => void;

export interface RedisConfig {
  /** Override the env-derived URL. Useful in tests. */
  url?: string | null;
  /**
   * Override the ioredis constructor. Tests pass a stub here so we don't
   * try to open a real socket.
   */
  redisCtor?: typeof Redis;
}

// ---------- bootstrap ----------

/**
 * Resolve config + (lazily) open the two connections. Idempotent — calling
 * this repeatedly returns the same module-level handles.
 *
 * Returns a synchronous shape because consumers (route handlers, WS open
 * callbacks) shouldn't have to await before they can publish.
 */
export function getRedisClients(config: RedisConfig = {}): {
  publisher: Redis | null;
  subscriber: Redis | null;
  fallbackEmitter: EventEmitter | null;
  hasRedis: boolean;
} {
  const url = config.url ?? process.env.REDIS_URL ?? null;

  if (!url) {
    if (!fallbackEmitter) {
      fallbackEmitter = new EventEmitter();
      // Many WS connections × multiple channels each = lots of listeners on
      // the same emitter. Raise the cap so we don't spam MaxListenersExceeded.
      fallbackEmitter.setMaxListeners(0);
    }
    if (!didWarnNoRedis) {
      didWarnNoRedis = true;
      log.warn(
        "WS fan-out disabled, no REDIS_URL — using in-process EventEmitter (single-instance only)",
      );
    }
    return {
      publisher: null,
      subscriber: null,
      fallbackEmitter,
      hasRedis: false,
    };
  }

  if (publisher && subscriber) {
    return { publisher, subscriber, fallbackEmitter: null, hasRedis: true };
  }

  // Lazy import — ioredis is a heavy module and we don't want to drag it
  // into the dev fallback path or into module-init for callers that never
  // hit this function. The dynamic-import here is sync from the caller's
  // perspective because Bun resolves the workspace lookup synchronously
  // once the dependency is installed; if it fails we fall back to the
  // emitter and log loudly.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RedisCtor =
      config.redisCtor ?? (require("ioredis").default ?? require("ioredis"));
    const pub: Redis = new RedisCtor(url, {
      // Reconnect aggressively; the API process can't usefully recover from
      // a permanently-dead Redis but a transient blip shouldn't kill the
      // socket forever. Cap at 2s — anything beyond that and we're in an
      // ops-page situation, not a "wait it out" situation.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      retryStrategy(times: number) {
        return Math.min(2000, 100 + times * 100);
      },
    });
    const sub: Redis = new RedisCtor(url, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
      retryStrategy(times: number) {
        return Math.min(2000, 100 + times * 100);
      },
    });

    // Demux the single connection-level `message` event into per-channel
    // local subscribers. Without this, only one WS connection per channel
    // would actually receive forwarded events.
    sub.on("message", (channel: string, message: string) => {
      const handlers = channelHandlers.get(channel);
      if (!handlers || handlers.size === 0) return;
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch (err) {
        log.warn(
          { channel, err: (err as Error).message },
          "redis.subscribe.parse_failed",
        );
        return;
      }
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          log.warn(
            { channel, err: (err as Error).message },
            "redis.subscribe.handler_threw",
          );
        }
      }
    });

    pub.on("error", (err: Error) => {
      log.warn({ err: err.message }, "redis.publisher.error");
    });
    sub.on("error", (err: Error) => {
      log.warn({ err: err.message }, "redis.subscriber.error");
    });

    publisher = pub;
    subscriber = sub;

    log.info({ urlMasked: maskUrl(url) }, "redis.connected");
    return { publisher: pub, subscriber: sub, fallbackEmitter: null, hasRedis: true };
  } catch (err) {
    // ioredis not installed, or the URL is malformed. Fall back to the
    // in-process emitter and log loudly so the operator notices.
    log.warn(
      { err: (err as Error).message },
      "redis.init_failed_falling_back_to_emitter",
    );
    if (!fallbackEmitter) {
      fallbackEmitter = new EventEmitter();
      fallbackEmitter.setMaxListeners(0);
    }
    return {
      publisher: null,
      subscriber: null,
      fallbackEmitter,
      hasRedis: false,
    };
  }
}

// ---------- publish ----------

/**
 * Fire-and-forget publish to a channel. JSON-serialises `payload` and writes
 * it to whichever transport is active. Errors are swallowed (logged) — we
 * don't want a fan-out hiccup to bubble up and 500 the inbound HTTP request
 * that triggered it.
 */
export async function publishChannel(
  channel: string,
  payload: unknown,
  config: RedisConfig = {},
): Promise<void> {
  const { publisher: pub, fallbackEmitter: emitter } = getRedisClients(config);
  const message = JSON.stringify(payload);

  if (pub) {
    try {
      await pub.publish(channel, message);
    } catch (err) {
      log.warn(
        { channel, err: (err as Error).message },
        "redis.publish.failed",
      );
    }
    return;
  }

  if (emitter) {
    // Emit synchronously — keeps the dev path snappy. JSON-round-trip here
    // so subscribers in the emitter path get the same deserialisation
    // semantics as the Redis path (e.g. bigints stay as strings).
    try {
      emitter.emit(channel, JSON.parse(message));
    } catch (err) {
      log.warn(
        { channel, err: (err as Error).message },
        "emitter.publish.failed",
      );
    }
  }
}

// ---------- subscribe ----------

/**
 * Register a callback for messages on `channel`. Returns an `unsubscribe`
 * function that detaches the callback. When the last callback for a channel
 * goes away we issue a Redis UNSUBSCRIBE so we stop receiving traffic for
 * channels nobody cares about.
 */
export function subscribeChannel(
  channel: string,
  onMessage: (payload: unknown) => void,
  config: RedisConfig = {},
): () => void {
  const { subscriber: sub, fallbackEmitter: emitter } = getRedisClients(config);

  if (sub) {
    let handlers = channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      channelHandlers.set(channel, handlers);
      // First subscriber for this channel — issue a Redis SUBSCRIBE. Errors
      // are logged but not rethrown; ioredis will retry on reconnect.
      sub.subscribe(channel).catch((err: Error) => {
        log.warn(
          { channel, err: err.message },
          "redis.subscribe.subscribe_failed",
        );
      });
    }
    handlers.add(onMessage);

    return () => {
      const set = channelHandlers.get(channel);
      if (!set) return;
      set.delete(onMessage);
      if (set.size === 0) {
        channelHandlers.delete(channel);
        sub.unsubscribe(channel).catch((err: Error) => {
          log.warn(
            { channel, err: err.message },
            "redis.subscribe.unsubscribe_failed",
          );
        });
      }
    };
  }

  if (emitter) {
    emitter.on(channel, onMessage);
    return () => {
      emitter.off(channel, onMessage);
    };
  }

  // Neither path available — return a no-op so callers don't crash.
  return () => {};
}

// ---------- teardown (tests) ----------

/**
 * Tear down both connections + reset module state. Tests use this between
 * cases so a fixture leak doesn't bleed into the next assertion.
 */
export async function resetRedisClients(): Promise<void> {
  channelHandlers.clear();
  fallbackEmitter?.removeAllListeners();
  fallbackEmitter = null;
  didWarnNoRedis = false;
  const closers: Array<Promise<unknown>> = [];
  if (publisher) {
    closers.push(publisher.quit().catch(() => undefined));
    publisher = null;
  }
  if (subscriber) {
    closers.push(subscriber.quit().catch(() => undefined));
    subscriber = null;
  }
  await Promise.all(closers);
}

// ---------- helpers ----------

function maskUrl(url: string): string {
  // `redis://user:pass@host:port/db` → `redis://user:***@host:port/db`
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<malformed-url>";
  }
}
