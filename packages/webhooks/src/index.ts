/**
 * @bufi/webhooks — public surface.
 *
 * Two consumer audiences:
 *   1. apps/api routes + delivery worker (server-side fan-out)
 *   2. integrators verifying inbound POSTs (use the `/verify` subpath)
 */

export {
  signWebhook,
  verifyWebhook,
  generateWebhookSecret,
  hashSecret,
  type SignArgs,
  type VerifyArgs,
  type VerifyResult,
} from "./hmac";

export { buildNonce, nonceForEvent, type NonceComponents } from "./nonce";

export {
  decideNextAttempt,
  initialAttempt,
  DEFAULT_RETRY_DELAYS_MS,
  MAX_DELIVERY_ATTEMPTS,
  type NextAttemptDecision,
} from "./retry";

export {
  startDeliveryWorker,
  matchesFilter,
  cacheRawSecret,
  evictRawSecret,
  rawSecretCache,
  type DeliveryWorkerOptions,
  type DeliveryWorkerHandle,
  type SubscribeFn,
  type EnvelopeAdapter,
  type DeliveryFetcher,
} from "./delivery";

export { createSqliteWebhookStore } from "./storage-sqlite";
export type {
  SubscriptionStore,
  DeliveryAttemptStore,
  WebhookStore,
} from "./storage";

export {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_HEADER_SIGNATURE,
  WEBHOOK_HEADER_NONCE,
  WEBHOOK_HEADER_TIMESTAMP,
  WEBHOOK_HEADER_EVENT_TYPE,
  WEBHOOK_HEADER_ATTEMPT,
  DEFAULT_RETRY_DELAYS_MS as DEFAULT_RETRY_DELAYS_MS_ALIAS,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookFilter,
  type WebhookSubscription,
  type WebhookSubscriptionStatus,
  type StoredWebhookSubscription,
  type DeliveryAttempt,
  type DeliveryAttemptStatus,
  type FillWebhookEvent,
  type LiquidationWebhookEvent,
  type FundingWebhookEvent,
  type Address,
  type Hex,
} from "./types";

export { verifyWebhookRequest } from "./verify";
