import { cn } from "@/utils";
import type { OverallStatus } from "@/lib/status/types";

interface StatusBannerProps {
  status: OverallStatus;
  /** ISO timestamp of when the probes finished — used for "checked X ago". */
  generatedAt: string;
  /** How many services we probed in total (drives the subtitle). */
  totalServices: number;
  /** How many services came back operational. */
  operationalCount: number;
}

/**
 * Top-of-page banner — colour codes the entire current state at a
 * glance. The banner is mobile-first: stacks vertically below `sm`,
 * goes side-by-side on tablet+.
 */
export function StatusBanner({
  status,
  generatedAt,
  totalServices,
  operationalCount,
}: StatusBannerProps) {
  const title =
    status === "operational"
      ? "All systems operational"
      : status === "degraded"
        ? "Some systems degraded"
        : "Major outage in progress";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-2xl border p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm",
        bannerBg(status),
      )}
      data-overall-status={status}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "shrink-0 mt-1 inline-flex h-3 w-3 rounded-full",
            dotColour(status),
            status === "operational"
              ? "animate-pulse"
              : status === "down"
                ? "animate-pulse"
                : "",
          )}
        />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {operationalCount} of {totalServices} services are operational
            <span aria-hidden> · </span>
            <BannerTime iso={generatedAt} />
          </p>
        </div>
      </div>
    </div>
  );
}

function BannerTime({ iso }: { iso: string }) {
  const t = Date.parse(iso);
  const ageSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const label =
    ageSec < 5
      ? "just now"
      : ageSec < 60
        ? `${ageSec} seconds ago`
        : ageSec < 3600
          ? `${Math.floor(ageSec / 60)} minutes ago`
          : `${Math.floor(ageSec / 3600)} hours ago`;
  return (
    <span>
      last checked{" "}
      <time dateTime={iso} title={iso} className="font-medium">
        {label}
      </time>
    </span>
  );
}

function bannerBg(status: OverallStatus): string {
  switch (status) {
    case "operational":
      return "bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50";
    case "degraded":
      return "bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50";
    case "down":
      return "bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/50";
  }
}

function dotColour(status: OverallStatus): string {
  switch (status) {
    case "operational":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "down":
      return "bg-red-500";
  }
}
