/**
 * Realtime channel naming + JSON message schemas for the Bun WS + Redis
 * pub/sub fan-out.
 *
 * The schemas now live in `@bufi/realtime/channels` so cross-process
 * publishers (matcher intent-notify, Wave H1) share the wire contract.
 * This file is a thin re-export to keep the existing call sites in
 * `routes/ws.ts` and `routes/realtime.ts` working untouched.
 *
 * Wave H1 — the extraction PR. PR #56 lived here verbatim.
 */

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
} from "@bufi/realtime";
