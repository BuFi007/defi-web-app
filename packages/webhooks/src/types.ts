/**
 * Public types for the @bufi/webhooks event delivery surface (Wave H2).
 *
 * Webhook events mirror the Redis fan-out envelopes from
 * `apps/api/src/lib/realtime.ts` (PR #56) but include extra on-chain context
 * (chainId, txHash, blockNumber, addresses) so integrators can reconcile
 * deliveries against an indexer / explorer without re-deriving fields.
 *
 * NOTE: all `*E18` and atomic-amount fields are decimal strings, not numbers.
 * JSON parsers happily silently truncate bigints, so the wire format keeps
 * them as strings and integrators are expected to BigInt-parse on receipt.
 */

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** Discriminator for the three webhook event types this surface emits. */
export type WebhookEventType = "fill" | "liquidation" | "funding";

export const WEBHOOK_EVENT_TYPES: ReadonlyArray<WebhookEventType> = [
  "fill",
  "liquidation",
  "funding",
];

// ---------- per-event payload shapes ----------

/**
 * Settled-fill event. Emitted after a matcher / settlement tx confirms and
 * the corresponding `trades:<marketId>` Redis channel publishes. Carries the
 * maker + taker addresses so integrators can reconcile against on-chain logs.
 */
export interface FillWebhookEvent {
  type: "fill";
  chainId: number;
  marketId: Hex;
  maker: Address;
  taker: Address;
  priceE18: string;
  sizeE18: string;
  txHash: Hex;
  blockNumber: number;
  ts: number;
}

/**
 * Liquidation event. Includes the liquidator's reward and any socialised
 * loss that was distributed (`socializedLossAtomic`, USDC-atomic units).
 */
export interface LiquidationWebhookEvent {
  type: "liquidation";
  chainId: number;
  marketId: Hex;
  trader: Address;
  liquidator: Address;
  rewardAtomic: string;
  socializedLossAtomic: string;
  txHash: Hex;
  blockNumber: number;
  ts: number;
}

/**
 * Funding-rate update. `cumulativeFundingE18` is the running funding accrual
 * since market inception; `version` is the on-chain funding-state version
 * (so out-of-order frames can be discarded by the integrator).
 */
export interface FundingWebhookEvent {
  type: "funding";
  chainId: number;
  marketId: Hex;
  rateE18: string;
  markE18: string;
  cumulativeFundingE18: string;
  version: number;
  ts: number;
}

export type WebhookEvent =
  | FillWebhookEvent
  | LiquidationWebhookEvent
  | FundingWebhookEvent;

// ---------- subscription / filter ----------

/**
 * Filter applied per subscription. `events` is required; `markets` and
 * `minNotionalUsdc` are optional narrowing predicates.
 *
 * `minNotionalUsdc` is applied to `priceE18 * sizeE18 / 1e30` (USDC atomic ->
 * decimal) for fill events; ignored for funding/liquidation.
 */
export interface WebhookFilter {
  events: WebhookEventType[];
  /** Optional list of marketIds (lowercase hex). If empty/absent, all markets. */
  markets?: string[];
  /** Optional notional floor for fill events, as USDC-atomic decimal string. */
  minNotionalUsdc?: string;
}

export type WebhookSubscriptionStatus = "active" | "disabled";

export interface WebhookSubscription {
  id: string;
  /** Stable integrator handle, e.g. an API key id. Scopes list/revoke. */
  integratorId: string;
  url: string;
  /** HMAC secret. Stored hashed in DB; returned ONCE at create/rotate. */
  secret: string;
  filter: WebhookFilter;
  status: WebhookSubscriptionStatus;
  createdAt: number;
  updatedAt: number;
  /** Count of consecutive failed deliveries; resets to 0 after a 2xx. */
  failureCount: number;
  /** Last delivery attempt unix ms; undefined if never attempted. */
  lastAttemptAt?: number;
  /** Last 2xx delivery unix ms; undefined if never succeeded. */
  lastSuccessAt?: number;
  /** Operator-visible reason the subscription was disabled. */
  disabledReason?: string;
}

/**
 * Persisted form of a subscription. The wire shape (returned to integrators
 * on create/list) omits the raw `secret` after the first response — only the
 * `secretHash` lives in DB and is never echoed back.
 */
export interface StoredWebhookSubscription
  extends Omit<WebhookSubscription, "secret"> {
  secretHash: string;
}

export type DeliveryAttemptStatus =
  | "scheduled"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "dead_lettered";

export interface DeliveryAttempt {
  id: string;
  subscriptionId: string;
  /** Deterministic nonce = `${eventType}-${marketId}-${txHash}-${logIndex}`. */
  nonce: string;
  eventType: WebhookEventType;
  payloadJson: string;
  attempt: number;
  scheduledFor: number;
  status: DeliveryAttemptStatus;
  /** Last HTTP status code observed (undefined on transport errors). */
  lastStatusCode?: number;
  /** Last transport-level error message. */
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- HTTP request headers we emit ----------

export const WEBHOOK_HEADER_SIGNATURE = "X-Bufi-Signature";
export const WEBHOOK_HEADER_NONCE = "X-Bufi-Nonce";
export const WEBHOOK_HEADER_TIMESTAMP = "X-Bufi-Timestamp";
export const WEBHOOK_HEADER_EVENT_TYPE = "X-Bufi-Event";
export const WEBHOOK_HEADER_ATTEMPT = "X-Bufi-Attempt";

/**
 * Default backoff schedule applied to a failed delivery. Indexed by
 * `attempt` (1-based). The 5th entry is the last attempt before
 * dead-letter; the worker emits one more retry on attempt 5 then flags
 * the subscription as `disabled`.
 *
 * Schedule (from task spec): 1m, 5m, 30m, 6h, 24h.
 */
export const DEFAULT_RETRY_DELAYS_MS: ReadonlyArray<number> = [
  60 * 1_000,
  5 * 60 * 1_000,
  30 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
];

export const MAX_DELIVERY_ATTEMPTS = DEFAULT_RETRY_DELAYS_MS.length;
