/**
 * Storage abstraction for webhook subscriptions + delivery attempts.
 *
 * Defines the interfaces that the API routes + delivery worker consume. A
 * Bun-SQLite-backed implementation lives in `./storage-sqlite.ts`; production
 * deployments can swap in a Postgres adapter without touching consumers.
 *
 * Why a separate file from `@bufi/db`: keeping the webhook tables in a
 * companion DB (or eventually moving them to a managed Postgres) is easier
 * if their migration story is owned here, not in the shared
 * `@bufi/db` migrate() block.
 */

import type {
  DeliveryAttempt,
  DeliveryAttemptStatus,
  StoredWebhookSubscription,
  WebhookEventType,
  WebhookSubscriptionStatus,
} from "./types";

export interface SubscriptionStore {
  create(sub: StoredWebhookSubscription): Promise<void>;
  get(id: string): Promise<StoredWebhookSubscription | null>;
  listByIntegrator(integratorId: string): Promise<StoredWebhookSubscription[]>;
  listActive(): Promise<StoredWebhookSubscription[]>;
  updateSecretHash(id: string, secretHash: string, updatedAt: number): Promise<void>;
  updateStatus(
    id: string,
    status: WebhookSubscriptionStatus,
    updatedAt: number,
    reason?: string,
  ): Promise<void>;
  recordDeliveryOutcome(args: {
    id: string;
    success: boolean;
    attemptAt: number;
    failureCount: number;
    updatedAt: number;
  }): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DeliveryAttemptStore {
  create(attempt: DeliveryAttempt): Promise<void>;
  /** Has any attempt with this nonce already succeeded? Replay-protection. */
  hasSucceededNonce(subscriptionId: string, nonce: string): Promise<boolean>;
  listScheduledBefore(beforeMs: number, limit: number): Promise<DeliveryAttempt[]>;
  updateAttempt(args: {
    id: string;
    status: DeliveryAttemptStatus;
    lastStatusCode?: number;
    lastError?: string;
    scheduledFor?: number;
    attempt?: number;
    updatedAt: number;
  }): Promise<void>;
  listForSubscription(
    subscriptionId: string,
    limit?: number,
  ): Promise<DeliveryAttempt[]>;
}

export interface WebhookStore {
  subscriptions: SubscriptionStore;
  attempts: DeliveryAttemptStore;
  close?(): void;
}

export type { WebhookEventType };
