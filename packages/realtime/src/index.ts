/**
 * @bufi/realtime — cross-process Redis pub/sub + channel taxonomy.
 *
 * Producers (apps/api, ponder bridge, keepers) call `publishChannel`;
 * subscribers (WS handlers, matcher) call `subscribeChannel`. Channel
 * names + payload schemas live in `./channels`.
 *
 * Wave E6 (PR #56) originally landed this surface inside `apps/api`;
 * Wave H1 extracts it here so non-api callers can wire without depending
 * on the api workspace.
 */

export {
  getRedisClients,
  publishChannel,
  resetRedisClients,
  subscribeChannel,
  type RedisConfig,
} from "./redis";

export {
  PERPS_INTENT_INSERTED_CHANNEL,
  REALTIME_CHANNEL_KINDS,
  buildEnvelope,
  parseRealtimeChannel,
  realtimeChannel,
  type BookMessage,
  type FundingMessage,
  type PerpsIntentInsertedMessage,
  type RealtimeChannelKind,
  type RealtimeEnvelope,
  type RealtimePayload,
  type TradeMessage,
} from "./channels";
