/**
 * Client surface for /dashboard/webhooks (Wave I4).
 *
 * Lists the integrator's webhooks, hosts the creation form, and renders
 * the one-time secret modal when a new subscription is created.
 */

"use client";

import { useState } from "react";

import {
  useWebhookSubscriptions,
  type CreatedWebhookSubscriptionDto,
} from "@/lib/dashboard/use-webhooks";
import { useActiveDashboardApiKey } from "@/lib/dashboard/use-api-keys";

import { WebhookSubscriptionForm } from "./webhook-subscription-form";
import { WebhookSubscriptionTable } from "./webhook-subscription-table";
import { WebhookSecretReveal } from "./webhook-secret-reveal";

interface WebhooksClientProps {
  locale: string;
}

export function WebhooksClient({ locale }: WebhooksClientProps) {
  const { header } = useActiveDashboardApiKey();
  const subs = useWebhookSubscriptions();

  const [created, setCreated] = useState<CreatedWebhookSubscriptionDto | null>(
    null,
  );
  const [secretOpen, setSecretOpen] = useState(false);

  if (!header) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        Create an API key first — every webhook call is scoped to the key
        you send in the <code>X-Bufi-Api-Key</code> header. Head to{" "}
        <code>Dashboard → API keys</code>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <WebhookSubscriptionForm
        onCreated={(c) => {
          setCreated(c);
          setSecretOpen(true);
        }}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Your subscriptions</h3>
          {subs.isFetching && (
            <span className="text-xs text-muted-foreground">Refreshing…</span>
          )}
        </div>

        {subs.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
            Failed to load subscriptions:{" "}
            {(subs.error as Error)?.message ?? "unknown error"}
          </div>
        ) : subs.isLoading ? (
          <div className="rounded-md border border-border p-6 text-sm text-muted-foreground animate-pulse">
            Loading subscriptions…
          </div>
        ) : (
          <WebhookSubscriptionTable
            locale={locale}
            subscriptions={subs.data ?? []}
          />
        )}
      </section>

      <WebhookSecretReveal
        open={secretOpen}
        onOpenChange={setSecretOpen}
        subscriptionId={created?.id ?? null}
        secret={created?.secret ?? null}
        mode="create"
      />
    </div>
  );
}
