/**
 * List of an integrator's webhook subscriptions (Wave I4).
 *
 * Each row links to the per-subscription detail page (rotate secret, fire
 * test events, see delivery history) and exposes a quick-revoke action.
 */

"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/utils";

import {
  useDeleteWebhookSubscription,
  type WebhookSubscriptionDto,
} from "@/lib/dashboard/use-webhooks";

interface WebhookSubscriptionTableProps {
  locale: string;
  subscriptions: WebhookSubscriptionDto[];
}

export function WebhookSubscriptionTable({
  locale,
  subscriptions,
}: WebhookSubscriptionTableProps) {
  const remove = useDeleteWebhookSubscription();

  if (subscriptions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        No webhook subscriptions yet. Create one above to start receiving
        events.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>URL</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last attempt</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subscriptions.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell className="font-mono text-xs break-all max-w-[16rem]">
                <Link
                  href={`/${locale}/dashboard/webhooks/${sub.id}`}
                  className="hover:underline"
                >
                  {sub.url}
                </Link>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {sub.id}
                </div>
              </TableCell>
              <TableCell className="text-xs">
                {sub.filter.events.join(", ")}
                {sub.filter.markets && sub.filter.markets.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {sub.filter.markets.length} market filter
                    {sub.filter.markets.length === 1 ? "" : "s"}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <StatusPill
                  status={sub.status}
                  failureCount={sub.failureCount}
                />
                {sub.disabledReason && (
                  <div
                    className="text-[10px] text-destructive mt-0.5"
                    title={sub.disabledReason}
                  >
                    {sub.disabledReason}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {sub.lastAttemptAt
                  ? new Date(sub.lastAttemptAt).toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell className="text-right space-x-2">
                <Link
                  href={`/${locale}/dashboard/webhooks/${sub.id}`}
                  className="inline-flex"
                >
                  <Button size="sm" variant="outline">
                    Manage
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      typeof window !== "undefined" &&
                      window.confirm(
                        `Revoke webhook ${sub.id}? This cannot be undone.`,
                      )
                    ) {
                      remove.mutate(sub.id);
                    }
                  }}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusPill({
  status,
  failureCount,
}: {
  status: WebhookSubscriptionDto["status"];
  failureCount: number;
}) {
  const isHealthy = status === "active" && failureCount === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5",
        isHealthy
          ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
          : status === "active"
            ? "bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
            : "bg-red-100 dark:bg-red-950/40 text-red-900 dark:text-red-200",
      )}
    >
      {status}
      {failureCount > 0 && ` · ${failureCount}`}
    </span>
  );
}
