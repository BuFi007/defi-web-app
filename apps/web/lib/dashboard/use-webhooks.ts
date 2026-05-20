/**
 * Typed client + TanStack Query bindings for the Wave H2 webhook
 * subscription routes (apps/api/src/routes/webhooks/subscriptions.ts).
 *
 * Endpoints consumed:
 *
 *   POST   /webhooks/subscriptions             create + return one-time secret
 *   GET    /webhooks/subscriptions             list
 *   GET    /webhooks/subscriptions/:id         fetch one
 *   DELETE /webhooks/subscriptions/:id         revoke
 *   POST   /webhooks/subscriptions/:id/rotate-secret
 *   POST   /webhooks/subscriptions/:id/test    fire a synthetic event
 *
 * Auth: `X-Bufi-Api-Key: <id>.<secret>` — pulled from
 * `useActiveDashboardApiKey()` (lib/dashboard/use-api-keys.ts).
 *
 * NOTE: the API doesn't currently expose a delivery-attempts history route.
 * `useDeliveryAttempts()` is a forward-compatible shape — if the route
 * exists it returns the parsed list; otherwise it returns an empty array
 * and a typed `unavailable: true` flag the UI can render a "coming soon"
 * card against.
 */

"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { resilientFetch, resilientJsonFetch } from "@/lib/api-client";

import { dashboardApiUrl } from "./api-base";
import { useActiveDashboardApiKey } from "./use-api-keys";

export type WebhookEventType = "fill" | "liquidation" | "funding";

export const ALL_WEBHOOK_EVENT_TYPES: ReadonlyArray<WebhookEventType> = [
  "fill",
  "liquidation",
  "funding",
];

export type WebhookSubscriptionStatus = "active" | "disabled";

export interface WebhookSubscriptionFilter {
  events: WebhookEventType[];
  markets?: string[];
  minNotionalUsdc?: string;
}

export interface WebhookSubscriptionDto {
  id: string;
  url: string;
  filter: WebhookSubscriptionFilter;
  status: WebhookSubscriptionStatus;
  createdAt: number;
  updatedAt: number;
  failureCount: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  disabledReason: string | null;
}

export interface CreatedWebhookSubscriptionDto extends WebhookSubscriptionDto {
  /** One-time-shown HMAC secret. The server NEVER returns it again. */
  secret: string;
}

export interface CreateWebhookSubscriptionInput {
  url: string;
  filter: WebhookSubscriptionFilter;
}

export interface TestWebhookSubscriptionInput {
  eventType?: WebhookEventType;
  marketId?: string;
}

export interface TestWebhookSubscriptionResult {
  attemptId: string;
  delivered: boolean;
  statusCode: number | null;
}

export interface RotateWebhookSecretResult {
  id: string;
  secret: string;
  rotatedAt: number;
}

export interface DeliveryAttemptDto {
  id: string;
  subscriptionId: string;
  eventType: WebhookEventType;
  attemptedAt: number;
  statusCode: number | null;
  ok: boolean;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface DeliveryAttemptsResponse {
  attempts: DeliveryAttemptDto[];
  /** True when the API doesn't expose the route yet — UI shows "coming soon". */
  unavailable: boolean;
}

// ---------- header helpers ----------

function authHeader(apiKey: string | null): Record<string, string> {
  if (!apiKey) return {};
  return { "X-Bufi-Api-Key": apiKey };
}

async function unwrapJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "<unreadable body>";
    }
    throw new Error(`${label} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------- raw client (mostly for the rare non-hook caller) ----------

export async function listWebhookSubscriptions(
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebhookSubscriptionDto[]> {
  const res = await resilientFetch(dashboardApiUrl("/webhooks/subscriptions"), {
    method: "GET",
    headers: { Accept: "application/json", ...authHeader(apiKey) },
    signal,
  });
  const body = await unwrapJson<{ subscriptions: WebhookSubscriptionDto[] }>(
    res,
    "list webhook subscriptions",
  );
  return body.subscriptions;
}

export async function getWebhookSubscription(
  apiKey: string,
  id: string,
  signal?: AbortSignal,
): Promise<WebhookSubscriptionDto> {
  const res = await resilientFetch(
    dashboardApiUrl(`/webhooks/subscriptions/${encodeURIComponent(id)}`),
    {
      method: "GET",
      headers: { Accept: "application/json", ...authHeader(apiKey) },
      signal,
    },
  );
  return unwrapJson<WebhookSubscriptionDto>(res, "get webhook subscription");
}

export async function createWebhookSubscription(
  apiKey: string,
  input: CreateWebhookSubscriptionInput,
): Promise<CreatedWebhookSubscriptionDto> {
  const res = await resilientJsonFetch(dashboardApiUrl("/webhooks/subscriptions"), {
    method: "POST",
    headers: { ...authHeader(apiKey) },
    body: JSON.stringify(input),
    // 201/200 only — never retry POST on 4xx, and the default retry policy
    // already filters non-5xx/429 so this is fine.
  });
  return unwrapJson<CreatedWebhookSubscriptionDto>(
    res,
    "create webhook subscription",
  );
}

export async function deleteWebhookSubscription(
  apiKey: string,
  id: string,
): Promise<void> {
  const res = await resilientFetch(
    dashboardApiUrl(`/webhooks/subscriptions/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      headers: { Accept: "application/json", ...authHeader(apiKey) },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`delete webhook failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function rotateWebhookSecret(
  apiKey: string,
  id: string,
): Promise<RotateWebhookSecretResult> {
  const res = await resilientJsonFetch(
    dashboardApiUrl(
      `/webhooks/subscriptions/${encodeURIComponent(id)}/rotate-secret`,
    ),
    {
      method: "POST",
      headers: { ...authHeader(apiKey) },
      body: JSON.stringify({}),
    },
  );
  return unwrapJson<RotateWebhookSecretResult>(res, "rotate webhook secret");
}

export async function testWebhookSubscription(
  apiKey: string,
  id: string,
  input: TestWebhookSubscriptionInput,
): Promise<TestWebhookSubscriptionResult> {
  const body = {
    event: {
      ...(input.eventType ? { type: input.eventType } : {}),
      ...(input.marketId ? { marketId: input.marketId } : {}),
    },
  };
  const res = await resilientJsonFetch(
    dashboardApiUrl(`/webhooks/subscriptions/${encodeURIComponent(id)}/test`),
    {
      method: "POST",
      headers: { ...authHeader(apiKey) },
      body: JSON.stringify(body),
    },
  );
  return unwrapJson<TestWebhookSubscriptionResult>(
    res,
    "test webhook subscription",
  );
}

export async function fetchDeliveryAttempts(
  apiKey: string,
  id: string,
  signal?: AbortSignal,
): Promise<DeliveryAttemptsResponse> {
  const res = await resilientFetch(
    dashboardApiUrl(
      `/webhooks/subscriptions/${encodeURIComponent(id)}/attempts`,
    ),
    {
      method: "GET",
      headers: { Accept: "application/json", ...authHeader(apiKey) },
      signal,
    },
  );
  if (res.status === 404) {
    // Route hasn't shipped yet — UI shows "coming soon" card.
    return { attempts: [], unavailable: true };
  }
  const body = await unwrapJson<{ attempts: DeliveryAttemptDto[] }>(
    res,
    "list delivery attempts",
  );
  return { attempts: body.attempts, unavailable: false };
}

// ---------- TanStack Query hooks ----------

const WEBHOOKS_QUERY_KEY = ["dashboard", "webhooks"] as const;
const WEBHOOK_DETAIL_QUERY_KEY = (id: string) =>
  ["dashboard", "webhooks", id] as const;
const WEBHOOK_ATTEMPTS_QUERY_KEY = (id: string) =>
  ["dashboard", "webhooks", id, "attempts"] as const;

export function useWebhookSubscriptions(): UseQueryResult<
  WebhookSubscriptionDto[],
  Error
> {
  const { header } = useActiveDashboardApiKey();
  return useQuery({
    queryKey: [...WEBHOOKS_QUERY_KEY, header ?? "anon"],
    queryFn: ({ signal }) => listWebhookSubscriptions(header ?? "", signal),
    enabled: header !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useWebhookSubscription(
  id: string | null,
): UseQueryResult<WebhookSubscriptionDto, Error> {
  const { header } = useActiveDashboardApiKey();
  return useQuery({
    queryKey: id ? WEBHOOK_DETAIL_QUERY_KEY(id) : ["dashboard", "webhooks", "none"],
    queryFn: ({ signal }) =>
      getWebhookSubscription(header ?? "", id ?? "", signal),
    enabled: header !== null && id !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDeliveryAttempts(
  id: string | null,
): UseQueryResult<DeliveryAttemptsResponse, Error> {
  const { header } = useActiveDashboardApiKey();
  return useQuery({
    queryKey: id
      ? WEBHOOK_ATTEMPTS_QUERY_KEY(id)
      : ["dashboard", "webhooks", "attempts", "none"],
    queryFn: ({ signal }) =>
      fetchDeliveryAttempts(header ?? "", id ?? "", signal),
    enabled: header !== null && id !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useCreateWebhookSubscription(): UseMutationResult<
  CreatedWebhookSubscriptionDto,
  Error,
  CreateWebhookSubscriptionInput
> {
  const { header } = useActiveDashboardApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookSubscriptionInput) => {
      if (!header) {
        return Promise.reject(
          new Error("No active API key — create or select one first."),
        );
      }
      return createWebhookSubscription(header, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
    },
  });
}

export function useDeleteWebhookSubscription(): UseMutationResult<
  void,
  Error,
  string
> {
  const { header } = useActiveDashboardApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      if (!header) {
        return Promise.reject(
          new Error("No active API key — create or select one first."),
        );
      }
      return deleteWebhookSubscription(header, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
    },
  });
}

export function useRotateWebhookSecret(): UseMutationResult<
  RotateWebhookSecretResult,
  Error,
  string
> {
  const { header } = useActiveDashboardApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      if (!header) {
        return Promise.reject(
          new Error("No active API key — create or select one first."),
        );
      }
      return rotateWebhookSecret(header, id);
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: WEBHOOK_DETAIL_QUERY_KEY(id) });
      qc.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
    },
  });
}

export function useTestWebhookSubscription(): UseMutationResult<
  TestWebhookSubscriptionResult,
  Error,
  { id: string; input: TestWebhookSubscriptionInput }
> {
  const { header } = useActiveDashboardApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => {
      if (!header) {
        return Promise.reject(
          new Error("No active API key — create or select one first."),
        );
      }
      return testWebhookSubscription(header, id, input);
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: WEBHOOK_ATTEMPTS_QUERY_KEY(id) });
      qc.invalidateQueries({ queryKey: WEBHOOK_DETAIL_QUERY_KEY(id) });
    },
  });
}
