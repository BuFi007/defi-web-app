/**
 * Fire-a-test-event control (Wave I4).
 *
 * The API exposes `POST /webhooks/subscriptions/:id/test` which crafts a
 * synthetic envelope (matching the type the subscription filters on) and
 * delivers it via the same worker that handles live events. Returns
 * `{ attemptId, delivered, statusCode }`. The UI surfaces all three so
 * the integrator can confirm both transport (HTTP 2xx vs 5xx) and
 * receiver readiness (the body of their handler must verify the HMAC).
 */

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils";

import {
  ALL_WEBHOOK_EVENT_TYPES,
  useTestWebhookSubscription,
  type WebhookEventType,
} from "@/lib/dashboard/use-webhooks";

interface WebhookTestRunnerProps {
  subscriptionId: string;
  availableEvents: WebhookEventType[];
}

export function WebhookTestRunner({
  subscriptionId,
  availableEvents,
}: WebhookTestRunnerProps) {
  const eventOptions =
    availableEvents.length > 0 ? availableEvents : [...ALL_WEBHOOK_EVENT_TYPES];

  const [eventType, setEventType] = useState<WebhookEventType>(
    eventOptions[0] ?? "fill",
  );
  const mutation = useTestWebhookSubscription();

  const handleFire = () => {
    if (mutation.isPending) return;
    mutation.mutate({
      id: subscriptionId,
      input: { eventType },
    });
  };

  const last = mutation.data;

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">Fire a test event</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Sends a synthetic envelope to your URL via the live delivery
          worker. The signature header is generated against this
          subscription's current HMAC secret.
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex flex-col gap-1 md:flex-1">
          <label className="text-xs font-medium">Event type</label>
          <Select
            value={eventType}
            onValueChange={(v) => setEventType(v as WebhookEventType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eventOptions.map((opt) => (
                <SelectItem key={opt} value={opt} className="capitalize">
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleFire} disabled={mutation.isPending}>
          {mutation.isPending ? "Firing…" : "Fire test event"}
        </Button>
      </div>

      {mutation.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2">
          {(mutation.error as Error)?.message ?? "Test failed."}
        </div>
      )}

      {last && (
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            last.delivered
              ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/30"
              : "border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30",
          )}
        >
          <div className="font-semibold">
            {last.delivered
              ? "Delivered."
              : "Delivery failed — retried per webhook policy."}
          </div>
          <div className="mt-1 text-muted-foreground">
            attemptId:{" "}
            <code className="px-1 py-0.5 rounded bg-muted/60">
              {last.attemptId}
            </code>
            {" · "}HTTP {last.statusCode ?? "—"}
          </div>
        </div>
      )}
    </div>
  );
}
