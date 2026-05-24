/**
 * Form for creating a new webhook subscription (Wave I4).
 *
 * Mirrors the request shape `createBodySchema` expects on the API side:
 *
 *   { url: string, filter: { events: WebhookEventType[], markets?, minNotionalUsdc? } }
 *
 * On successful POST, the parent component is given the response payload
 * (which includes the one-time-shown HMAC secret) so it can pop the
 * `<WebhookSecretReveal />` modal.
 */

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

import {
  ALL_WEBHOOK_EVENT_TYPES,
  useCreateWebhookSubscription,
  type CreatedWebhookSubscriptionDto,
  type WebhookEventType,
} from "@/lib/dashboard/use-webhooks";

interface WebhookSubscriptionFormProps {
  onCreated: (created: CreatedWebhookSubscriptionDto) => void;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function WebhookSubscriptionForm({
  onCreated,
}: WebhookSubscriptionFormProps) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Record<WebhookEventType, boolean>>({
    fill: true,
    liquidation: false,
    funding: false,
  });
  const [marketsText, setMarketsText] = useState("");
  const [minNotional, setMinNotional] = useState("");

  const mutation = useCreateWebhookSubscription();

  const selectedEvents = ALL_WEBHOOK_EVENT_TYPES.filter((t) => events[t]);
  const markets = marketsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const canSubmit =
    isHttpUrl(url) &&
    selectedEvents.length > 0 &&
    (!minNotional || /^\d+$/.test(minNotional));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    try {
      const created = await mutation.mutateAsync({
        url,
        filter: {
          events: selectedEvents,
          ...(markets.length > 0 ? { markets } : {}),
          ...(minNotional ? { minNotionalUsdc: minNotional } : {}),
        },
      });
      onCreated(created);
      // Reset URL + notional but keep checkbox state — common case is
      // registering several URLs against the same event filter.
      setUrl("");
      setMinNotional("");
      setMarketsText("");
    } catch {
      // mutation.error is surfaced below; nothing extra to do here.
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4"
    >
      <div>
        <h3 className="text-base font-semibold">Register a webhook</h3>
        <p className="text-xs text-muted-foreground mt-1">
          We POST signed events to your URL. The HMAC secret is shown once
          after creation — copy it before closing the dialog.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="webhook-url" className="text-xs font-medium">
          Endpoint URL
        </label>
        <Input
          id="webhook-url"
          placeholder="https://example.com/bufi/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">Event types</legend>
        <div className="flex flex-wrap gap-4">
          {ALL_WEBHOOK_EVENT_TYPES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={events[type]}
                onCheckedChange={(c) =>
                  setEvents((prev) => ({ ...prev, [type]: c === true }))
                }
              />
              <span className="capitalize">{type}</span>
            </label>
          ))}
        </div>
        {selectedEvents.length === 0 && (
          <p className="text-[11px] text-destructive">
            Pick at least one event type.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="webhook-markets" className="text-xs font-medium">
          Market IDs (optional, comma-separated)
        </label>
        <Input
          id="webhook-markets"
          placeholder="0xabc…, 0xdef…"
          value={marketsText}
          onChange={(e) => setMarketsText(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="webhook-min-notional" className="text-xs font-medium">
          Min notional (USDC atomic units, optional)
        </label>
        <Input
          id="webhook-min-notional"
          placeholder="e.g. 1000000 for 1 USDC"
          value={minNotional}
          onChange={(e) => setMinNotional(e.target.value)}
          inputMode="numeric"
        />
      </div>

      {mutation.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2">
          {(mutation.error as Error)?.message ?? "Create failed."}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create subscription"}
        </Button>
      </div>
    </form>
  );
}
