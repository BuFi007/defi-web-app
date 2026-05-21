/**
 * Recent delivery attempts for a webhook subscription (Wave I4).
 *
 * The API doesn't expose this route yet — `fetchDeliveryAttempts()`
 * returns `{ unavailable: true }` on 404 so the UI can render an
 * informative placeholder instead of a generic error. When the route
 * ships, the existing rows render automatically against the same shape.
 */

"use client";

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
  useDeliveryAttempts,
  type DeliveryAttemptDto,
} from "@/lib/dashboard/use-webhooks";

interface DeliveryAttemptsTableProps {
  subscriptionId: string;
}

export function DeliveryAttemptsTable({
  subscriptionId,
}: DeliveryAttemptsTableProps) {
  const query = useDeliveryAttempts(subscriptionId);

  if (query.isLoading) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground animate-pulse">
        Loading delivery attempts…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
        Failed to load attempts:{" "}
        {(query.error as Error)?.message ?? "unknown error"}
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  if (data.unavailable) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-xs text-muted-foreground">
        Delivery-attempt history isn't exposed by the API yet. Fire a
        test event above to verify your endpoint — full history will
        light up once{" "}
        <code className="px-1 py-0.5 rounded bg-muted/60">
          GET /webhooks/subscriptions/:id/attempts
        </code>{" "}
        ships.
      </div>
    );
  }

  if (data.attempts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        No attempts recorded yet. Fire a test event above to generate one.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Attempt</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.attempts.map((attempt) => (
            <AttemptRow key={attempt.id} attempt={attempt} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AttemptRow({ attempt }: { attempt: DeliveryAttemptDto }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-[10px]">{attempt.id}</TableCell>
      <TableCell className="text-xs capitalize">{attempt.eventType}</TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex items-center rounded-full text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5",
            attempt.ok
              ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
              : "bg-red-100 dark:bg-red-950/40 text-red-900 dark:text-red-200",
          )}
        >
          {attempt.ok ? "ok" : "fail"} · {attempt.statusCode ?? "—"}
        </span>
        {attempt.errorMessage && (
          <div
            className="text-[10px] text-destructive mt-0.5 max-w-[16rem] truncate"
            title={attempt.errorMessage}
          >
            {attempt.errorMessage}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {attempt.durationMs != null ? `${attempt.durationMs} ms` : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(attempt.attemptedAt).toLocaleString()}
      </TableCell>
    </TableRow>
  );
}
