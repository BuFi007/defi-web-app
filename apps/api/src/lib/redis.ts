/**
 * Redis pub/sub abstraction for the API.
 *
 * The implementation now lives in `@bufi/realtime` so non-api workspaces
 * (matcher, future keepers) can share the same publish/subscribe surface
 * without a cross-app import. This file is a thin re-export to keep the
 * existing `import { publishChannel } from "../lib/redis"` call sites
 * (route handlers, WS handler) working untouched.
 *
 * Wave H1 — the extraction PR. PR #56 lived here verbatim.
 */

export {
  getRedisClients,
  publishChannel,
  resetRedisClients,
  subscribeChannel,
  type RedisConfig,
} from "@bufi/realtime";
