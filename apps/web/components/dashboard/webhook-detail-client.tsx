/**
 * Per-subscription detail surface (Wave I4).
 *
 * Compositions:
 *
 *   - Subscription metadata (URL, status, failure count, timestamps)
 *   - Rotate-secret button (one-time secret modal on success)
 *   - Test-event runner (reused from the list page)
 *   - Recent delivery attempts table
 *
 * Edits to the filter aren't exposed yet because the API only supports
 * create + delete + rotate + test. When `PATCH /webhooks/subscriptions/:id`
 * ships, an "Edit filter" affordance can land in this same panel.
 */

"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
  useRotateWebhookSecret,
  useWebhookSubscription,
  type RotateWebhookSecretResult,
} from "@/lib/dashboard/use-webhooks";
import { useActiveDashboardApiKey } from "@/lib/dashboard/use-api-keys";

import { WebhookSecretReveal } from "./webhook-secret-reveal";
import { WebhookTestRunner } from "./webhook-test-runner";
import { DeliveryAttemptsTable } from "./delivery-attempts-table";

interface WebhookDetailClientProps {
  locale: string;
  subscriptionId: string;
}

export function WebhookDetailClient({
  locale,
  subscriptionId,
}: WebhookDetailClientProps) {
  const { header } = useActiveDashboardApiKey();
  const query = useWebhookSubscription(subscriptionId);
  const rotate = useRotateWebhookSecret();

  const [rotated, setRotated] = useState<RotateWebhookSecretResult | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);

  const handleRotate = async () => {
    if (rotate.isPending) return;
    try {
      const result = await rotate.mutateAsync(subscriptionId);
      setRotated(result);
      setSecretOpen(true);
    } catch {
      // surfaced via rotate.error below
    }
  };

  if (!header) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        Select an active API key first. Head to{" "}
        <Link
          href={`/${locale}/dashboard/api-keys`}
          className="underline underline-offset-2"
        >
          Dashboard → API keys
        </Link>
        .
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground animate-pulse">
        Loading subscription…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
        Could not load subscription{" "}
        <code>{subscriptionId}</code>:{" "}
        {(query.error as Error)?.message ?? "not found"}.{" "}
        <Link
          href={`/${locale}/dashboard/webhooks`}
          className="underline underline-offset-2"
        >
          Back to list
        </Link>
      </div>
    );
  }

  const sub = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/${locale}/dashboard/webhooks`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to all subscriptions
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Subscription</h3>
            <p className="font-mono text-xs text-muted-foreground mt-1 break-all">
              {sub.id}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRotate}
            disabled={rotate.isPending}
          >
            {rotate.isPending ? "Rotating…" : "Rotate secret"}
          </Button>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <dt className="text-muted-foreground">URL</dt>
            <dd className="font-mono break-all mt-0.5">{sub.url}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="mt-0.5">
              {sub.status}
              {sub.disabledReason && (
                <span className="ml-1 text-destructive">
                  ({sub.disabledReason})
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Events</dt>
            <dd className="mt-0.5">{sub.filter.events.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Markets</dt>
            <dd className="mt-0.5">
              {sub.filter.markets && sub.filter.markets.length > 0
                ? sub.filter.markets.join(", ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Min notional</dt>
            <dd className="mt-0.5">{sub.filter.minNotionalUsdc ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Failure count</dt>
            <dd className="mt-0.5">{sub.failureCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last attempt</dt>
            <dd className="mt-0.5">
              {sub.lastAttemptAt
                ? new Date(sub.lastAttemptAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last success</dt>
            <dd className="mt-0.5">
              {sub.lastSuccessAt
                ? new Date(sub.lastSuccessAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-0.5">
              {new Date(sub.createdAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="mt-0.5">
              {new Date(sub.updatedAt).toLocaleString()}
            </dd>
          </div>
        </dl>

        {rotate.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2">
            Rotate failed: {(rotate.error as Error)?.message}
          </div>
        )}
      </section>

      <WebhookTestRunner
        subscriptionId={sub.id}
        availableEvents={sub.filter.events}
      />

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Recent delivery attempts</h3>
        <DeliveryAttemptsTable subscriptionId={sub.id} />
      </section>

      <WebhookSecretReveal
        open={secretOpen}
        onOpenChange={setSecretOpen}
        subscriptionId={rotated?.id ?? null}
        secret={rotated?.secret ?? null}
        mode="rotate"
      />
    </div>
  );
}
