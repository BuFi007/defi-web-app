import { cn } from "@/utils";
import type { ProbeResult, ServiceStatus } from "@/lib/status/types";

interface ServiceCardProps {
  result: ProbeResult;
}

/**
 * Single service card — Cloudflare-style. Status pill on the right,
 * latency chip below the name, structured details collapsed into a
 * native <details> so the card stays compact by default and the
 * operator can expand for deep diagnostics during an incident.
 */
export function ServiceCard({ result }: ServiceCardProps) {
  const { service, status, latencyMs, checkedAt, message, details } = result;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card/80 backdrop-blur-sm p-4 sm:p-5",
        "shadow-sm transition-colors",
        statusBorder(status),
      )}
      data-service-id={service.id}
      data-service-status={status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm sm:text-base font-semibold text-foreground truncate">
            {service.name}
            {service.indirect ? (
              <span className="ml-2 inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground align-middle">
                indirect
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {service.description}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {latencyMs !== null ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-foreground/80 font-medium">{latencyMs}ms</span>
            <span aria-hidden>·</span>
            <span>latency</span>
          </span>
        ) : (
          <span>no latency</span>
        )}
        <span aria-hidden>·</span>
        <RelativeTime iso={checkedAt} />
      </div>

      <p
        className={cn(
          "mt-2 text-sm",
          status === "down"
            ? "text-destructive"
            : status === "degraded"
              ? "text-amber-700 dark:text-amber-300"
              : "text-foreground/80",
        )}
      >
        {message}
      </p>

      {details && Object.keys(details).length > 0 ? (
        <details className="mt-3 group">
          <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
            Details
          </summary>
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {Object.entries(details).map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">{k}</dt>
                <dd
                  className="text-foreground/80 truncate font-mono"
                  title={String(v ?? "")}
                >
                  {v === null || v === undefined ? "—" : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: ServiceStatus }) {
  const label =
    status === "operational"
      ? "Operational"
      : status === "degraded"
        ? "Degraded"
        : status === "down"
          ? "Down"
          : "Unknown";
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
        statusBg(status),
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", statusDot(status))}
      />
      {label}
    </span>
  );
}

/**
 * Relative-time renderer — server-rendered with the absolute timestamp
 * as the title so a screen-reader user gets the exact moment. The label
 * itself is computed at render time; the page revalidates every 30s so
 * the visible "5s ago" stays close to truth.
 */
function RelativeTime({ iso }: { iso: string }) {
  const t = Date.parse(iso);
  const ageSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const label =
    ageSec < 5
      ? "just now"
      : ageSec < 60
        ? `${ageSec}s ago`
        : ageSec < 3600
          ? `${Math.floor(ageSec / 60)}m ago`
          : `${Math.floor(ageSec / 3600)}h ago`;
  return (
    <time dateTime={iso} title={iso}>
      checked {label}
    </time>
  );
}

function statusBg(status: ServiceStatus): string {
  switch (status) {
    case "operational":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "degraded":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    case "down":
      return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300";
    case "unknown":
      return "bg-muted text-muted-foreground";
  }
}

function statusDot(status: ServiceStatus): string {
  switch (status) {
    case "operational":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "down":
      return "bg-red-500";
    case "unknown":
      return "bg-muted-foreground/60";
  }
}

function statusBorder(status: ServiceStatus): string {
  switch (status) {
    case "operational":
      return "border-emerald-200/60 dark:border-emerald-900/40";
    case "degraded":
      return "border-amber-300/60 dark:border-amber-900/50";
    case "down":
      return "border-red-300/60 dark:border-red-900/50";
    case "unknown":
      return "border-border";
  }
}
