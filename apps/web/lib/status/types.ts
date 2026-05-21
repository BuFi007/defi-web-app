/**
 * Status page domain types.
 *
 * A "probe" is the act of asking a single service whether it is healthy.
 * Each probe returns a `ProbeResult`. The page-level aggregator collects
 * all probe results in parallel via `Promise.allSettled` so one slow or
 * crashing probe never blocks the others — even if every probe fails,
 * the page must still render.
 *
 * Status semantics:
 *   - "operational" : probe succeeded; latency within healthy budget
 *   - "degraded"    : probe succeeded but slow / partial signal
 *   - "down"        : probe failed (network error, non-2xx, schema mismatch,
 *                     or stale tip block)
 *   - "unknown"     : probe wasn't run (e.g. config missing) — UI shows
 *                     a neutral pill so the operator can tell "not yet
 *                     wired" apart from "broken right now".
 */

export type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

export type ProbeKind =
  | "api-health"
  | "ponder-graphql"
  | "pyth-hermes"
  | "rpc-arc"
  | "rpc-fuji"
  | "keeper-liveness";

export interface ServiceMeta {
  /** Stable identifier — used as JSON key + React key. */
  id: string;
  /** Human-readable name shown in the card header. */
  name: string;
  /** One-line description shown under the name. */
  description: string;
  /** Probe family — drives which probe runs and how the UI groups it. */
  kind: ProbeKind;
  /**
   * Indirect probe flag — UI shows a small "indirect" tag so the
   * operator knows this signal is inferred (e.g. "last write block
   * by keeper") instead of directly asking the service. Wave-F
   * follow-up replaces these with real `/health` routes on each keeper.
   */
  indirect?: boolean;
}

export interface ProbeResult {
  service: ServiceMeta;
  status: ServiceStatus;
  /** Wall-clock ms the probe took (one-shot). */
  latencyMs: number | null;
  /** ISO timestamp when this probe finished. */
  checkedAt: string;
  /** Short human-readable message — surfaces in the card body. */
  message: string;
  /**
   * Free-form structured payload — e.g. `{ blockNumber, blockTimestamp }`
   * for an RPC probe, or `{ uptime, version }` for the API. Rendered
   * inside the card details footer.
   */
  details?: Record<string, string | number | boolean | null>;
}

export type OverallStatus = "operational" | "degraded" | "down";

export interface StatusPageSnapshot {
  /** Server wall-clock the probes finished — drives "Last checked X ago". */
  generatedAt: string;
  overall: OverallStatus;
  results: ProbeResult[];
}
