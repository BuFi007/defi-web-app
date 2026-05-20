// Shared fan-out helper for keepers that publish settled state to the rest
// of the stack. Mirrors the Wave F2 envelope shape — two side-channels:
//
//   1. realtime  → POST /internal/realtime/publish (Redis pub/sub → Liveblocks
//                  → status page + open trade tape clients)
//   2. analytics → POST /internal/tinybird/ingest  (Tinybird raw datasource
//                  → market-tape & funding-history materialised views)
//
// Both endpoints are guarded by `INTERNAL_INGEST_TOKEN` server-side. When the
// token is unset here, this helper silently no-ops so:
//
//   - local dev:complete keeps working without realtime infra
//   - on-chain settlement still succeeds (publish failures NEVER block writes)
//   - missing/unhealthy ingest URLs don't surface as fatal keeper errors
//
// Fire-and-forget by design: callers do `void postPublish(...)` if they want
// the response or `await postPublish(...)` if they need timing.

const PUBLISH_TIMEOUT_MS = Number(process.env.INTERNAL_INGEST_TIMEOUT_MS ?? 2_000);

export interface RealtimeEnvelope {
  channel: string;
  payload: Record<string, unknown>;
}

export interface AnalyticsEnvelope {
  /** Tinybird datasource name, e.g. "perp_match_settled". */
  dataset: string;
  /** Flat row matching the datasource schema. JSON-serializable. */
  row: Record<string, unknown>;
}

export interface PublishEnvelope {
  realtime?: RealtimeEnvelope;
  analytics?: AnalyticsEnvelope;
}

export interface PublishResult {
  realtime?: { ok: boolean; status?: number; error?: string };
  analytics?: { ok: boolean; status?: number; error?: string };
  /** True when the helper was a deliberate no-op (token unset). */
  skipped?: boolean;
}

interface IngestConfig {
  baseUrl: string;
  token: string;
}

function readConfig(): IngestConfig | null {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  if (!token) return null;
  const baseUrl =
    process.env.INTERNAL_INGEST_URL ??
    process.env.API_BASE_URL ??
    "http://localhost:3002";
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

async function postOne(
  cfg: IngestConfig,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body, bigintReplacer),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// JSON.stringify can't serialise bigint by default. Keepers pass bigint
// fields (fillSizeE18, blockNumber) into the envelope; coerce to string
// in transport so the Tinybird datasource sees a stable lossless decimal.
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function postPublish(envelope: PublishEnvelope): Promise<PublishResult> {
  const cfg = readConfig();
  if (!cfg) return { skipped: true };

  const tasks: Array<Promise<void>> = [];
  const result: PublishResult = {};

  if (envelope.realtime) {
    tasks.push(
      postOne(cfg, "/internal/realtime/publish", envelope.realtime).then((r) => {
        result.realtime = r;
      }),
    );
  }
  if (envelope.analytics) {
    tasks.push(
      postOne(cfg, "/internal/tinybird/ingest", envelope.analytics).then((r) => {
        result.analytics = r;
      }),
    );
  }

  await Promise.all(tasks);
  return result;
}
