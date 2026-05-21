/**
 * Convenience type re-export — same surface as the named exports from
 * `./channels`, kept here so callers can do `import type { ... } from
 * "@bufi/realtime/types"` if they prefer types-only paths.
 */

export type {
  BookMessage,
  FundingMessage,
  PerpsIntentInsertedMessage,
  RealtimeChannelKind,
  RealtimeEnvelope,
  RealtimePayload,
  TradeMessage,
} from "./channels";

export type { RedisConfig } from "./redis";
