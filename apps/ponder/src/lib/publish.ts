/**
 * Wave F2 — Ponder publish helper.
 *
 * Bridges the indexer to the realtime fan-out (`/internal/realtime/publish`
 * — PR #56) and the Tinybird ingest route (`/internal/tinybird/ingest` —
 * PR #58). Each indexed perp event optionally calls `publishEvent` to
 * forward a realtime envelope, an analytics row, or both, in parallel.
 *
 * Auth model — TWO separate tokens deliberately:
 *   • INTERNAL_REALTIME_TOKEN  → realtime publish route (PR #56)
 *   • INTERNAL_INGEST_TOKEN    → Tinybird ingest route (PR #58)
 * The routes were authored by independent waves so they don't share a
 * secret. Either may be unset (silent no-op for that side), which lets
 * dev Ponder boot without the API running.
 *
 * Wire shapes (do NOT drift — these are the canonical contracts):
 *
 *   POST /internal/realtime/publish
 *     headers: { "X-Internal-Token": $INTERNAL_REALTIME_TOKEN }
 *     body:    { kind: "trades"|"book"|"funding", marketId, data }
 *
 *   POST /internal/tinybird/ingest
 *     headers: { "X-Internal-Token": $INTERNAL_INGEST_TOKEN }
 *     body:    { dataset: "perp_match_settled"|"perp_position_change"
 *                       |"perp_funding_poked"|"perp_liquidation", row }
 *
 * Failure model — fire-and-forget. The source of truth is Ponder's DB
 * (already written before this helper is called). If the realtime hop or
 * the Tinybird hop fails we log a warning and move on; the matcher /
 * keeper services will eventually backfill or replay. Idempotency on
 * Tinybird is handled by the `event_id = ${txHash}-${logIndex}` column
 * convention (see `tinybird/datasources/*.datasource`).
 */

export type RealtimeChannelKind = "trades" | "book" | "funding";

export type TinybirdDataset =
  | "perp_match_settled"
  | "perp_position_change"
  | "perp_funding_poked"
  | "perp_liquidation";

export interface RealtimePublishPayload {
  kind: RealtimeChannelKind;
  marketId: string;
  data: Record<string, unknown>;
}

export interface AnalyticsPublishPayload {
  dataset: TinybirdDataset;
  row: Record<string, unknown>;
}

export interface PublishEnvelope {
  realtime?: RealtimePublishPayload;
  analytics?: AnalyticsPublishPayload;
}

/** Default API base when `PONDER_PUBLISH_API_BASE` is unset. Matches the
 *  default Hono port in `apps/api`. */
const DEFAULT_API_BASE = "http://localhost:3002";

interface PublishConfig {
  apiBase: string;
  realtimeToken: string | undefined;
  ingestToken: string | undefined;
}

/** Pulled out so unit tests can inject a deterministic config. Reads
 *  `process.env` lazily on every call — Ponder hot-reloads handlers in
 *  dev so we don't want to cache the snapshot. */
function readConfig(): PublishConfig {
  return {
    apiBase: process.env.PONDER_PUBLISH_API_BASE ?? DEFAULT_API_BASE,
    realtimeToken: process.env.INTERNAL_REALTIME_TOKEN,
    ingestToken: process.env.INTERNAL_INGEST_TOKEN,
  };
}

/**
 * Forward a realtime envelope and/or an analytics row to the API.
 *
 * • Each leg is independently gated on its token being set — call this
 *   from a handler that doesn't need both and the other half is a no-op.
 * • Both calls run in parallel via `Promise.allSettled` so a slow
 *   Tinybird hop doesn't serialise behind a slow Redis hop.
 * • Returns `void` — callers should `await` to defer the next handler
 *   side-effect, but never `throw` here (the DB write already
 *   succeeded; partial publish is recoverable from the indexed rows).
 */
export async function publishEvent(envelope: PublishEnvelope): Promise<void> {
  const { apiBase, realtimeToken, ingestToken } = readConfig();

  const tasks: Array<Promise<Response>> = [];
  const legs: Array<string> = [];

  if (envelope.realtime && realtimeToken) {
    legs.push(`realtime:${envelope.realtime.kind}`);
    tasks.push(
      fetch(`${apiBase}/internal/realtime/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": realtimeToken,
        },
        body: JSON.stringify(envelope.realtime),
      }),
    );
  }

  if (envelope.analytics && ingestToken) {
    legs.push(`tinybird:${envelope.analytics.dataset}`);
    tasks.push(
      fetch(`${apiBase}/internal/tinybird/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": ingestToken,
        },
        body: JSON.stringify(envelope.analytics),
      }),
    );
  }

  if (tasks.length === 0) return;

  const results = await Promise.allSettled(tasks);
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const leg = legs[i] ?? "unknown";
    if (result === undefined) continue;
    if (result.status === "rejected") {
      console.warn(`[ponder.publish] ${leg} threw`, result.reason);
      continue;
    }
    const response = result.value;
    if (!response.ok) {
      // Don't await response.text() — we don't want to stall the handler
      // on a slow upstream body read. The status is enough to triage.
      console.warn(`[ponder.publish] ${leg} non-2xx ${response.status}`);
    }
  }
}
