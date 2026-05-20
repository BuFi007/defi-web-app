/**
 * Internal ingest route — forwards events from the Ponder indexer and
 * keeper hooks into Tinybird's Events API.
 *
 * Auth model:
 *   - Caller must send `X-Internal-Token: $INTERNAL_INGEST_TOKEN`. The
 *     token is a shared secret between the API and the trusted
 *     publishers (Ponder + keepers); it is never exposed to browsers.
 *   - If `INTERNAL_INGEST_TOKEN` is unset on the server, every call is
 *     rejected with 503. Don't accept unauthenticated writes ever.
 *   - If `TINYBIRD_TOKEN` is unset, the route returns 503 with a clear
 *     "analytics disabled" message so callers can disable themselves.
 *
 * Wire model:
 *   - Tinybird's Events API is fire-and-forget — it returns 202 on a
 *     successful queue. Bad rows go to Tinybird's DLQ; we don't retry
 *     here. Caller idempotency is achieved via the deterministic
 *     `eventId = `${txHash}-${logIndex}`` convention enforced on the
 *     `.datasource` side, not by us.
 *
 * Body shape:
 *   { dataset: string, row: Record<string, unknown> }
 *
 * Allowed dataset values are the four BUFI datasources defined under
 * `/tinybird/datasources/`. Unknown datasets reject early.
 *
 * Returns:
 *   202 — `{ ok: true, dataset, queued: true }` on enqueue
 *   400 — bad body
 *   401 — missing/wrong X-Internal-Token
 *   503 — analytics disabled (TINYBIRD_TOKEN / INTERNAL_INGEST_TOKEN unset)
 *   502 — Tinybird upstream returned a non-2xx
 */
import { Hono } from "hono";
import { z } from "zod";

import { jsonError } from "../../helpers";

/** Datasources that this route is allowed to write to. Keep this list
 *  in sync with `/tinybird/datasources/*.datasource`. */
const ALLOWED_DATASETS = [
  "perp_match_settled",
  "perp_position_change",
  "perp_funding_poked",
  "perp_liquidation",
] as const;

type AllowedDataset = (typeof ALLOWED_DATASETS)[number];

const ingestBodySchema = z.object({
  dataset: z.enum(ALLOWED_DATASETS),
  row: z.record(z.unknown()),
});

const ingestBatchBodySchema = z.object({
  dataset: z.enum(ALLOWED_DATASETS),
  rows: z.array(z.record(z.unknown())).min(1).max(1000),
});

/** Tinybird Events API host. `us-east-1` is the default region; EU
 *  customers set TINYBIRD_REGION=eu to swap the host. */
export function tinybirdEventsUrl(dataset: AllowedDataset): string {
  const region = (process.env.TINYBIRD_REGION ?? "us-east-1").toLowerCase();
  const host =
    region === "eu"
      ? "api.eu-central-1.aws.tinybird.co"
      : region === "gcp-europe-west2" || region === "europe-west2"
        ? "api.europe-west2.gcp.tinybird.co"
        : "api.tinybird.co";
  return `https://${host}/v0/events?name=${encodeURIComponent(dataset)}`;
}

const tinybirdIngestRoutes = new Hono();

tinybirdIngestRoutes.post("/ingest", async (c) => {
  const tinybirdToken = process.env.TINYBIRD_TOKEN;
  const internalToken = process.env.INTERNAL_INGEST_TOKEN;

  if (!internalToken) {
    return c.json(
      {
        error: "analytics ingest disabled: INTERNAL_INGEST_TOKEN is unset",
      },
      503,
    );
  }
  if (!tinybirdToken) {
    return c.json(
      {
        error: "analytics ingest disabled: TINYBIRD_TOKEN is unset",
      },
      503,
    );
  }

  const callerToken = c.req.header("x-internal-token");
  if (!callerToken || callerToken !== internalToken) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const raw = await c.req.json().catch(() => ({}));
  // Accept either single-row { dataset, row } or batch { dataset, rows }.
  const batchParsed = ingestBatchBodySchema.safeParse(raw);
  const singleParsed = ingestBodySchema.safeParse(raw);
  if (!batchParsed.success && !singleParsed.success) {
    return c.json(
      {
        error: "bad body",
        issues: singleParsed.success ? [] : singleParsed.error.issues,
      },
      400,
    );
  }

  const dataset: AllowedDataset = batchParsed.success
    ? batchParsed.data.dataset
    : singleParsed.data!.dataset;
  const rows: Record<string, unknown>[] = batchParsed.success
    ? batchParsed.data.rows
    : [singleParsed.data!.row];

  // Tinybird's Events API accepts newline-delimited JSON. We send one
  // row per line; the dataset is in the query string.
  const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");

  try {
    const res = await fetch(tinybirdEventsUrl(dataset), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tinybirdToken}`,
        "Content-Type": "application/json",
      },
      body: ndjson,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      c.var.log.error("tinybird_ingest_upstream_error", {
        status: res.status,
        body: text.slice(0, 500),
      });
      return c.json(
        { error: "tinybird upstream error", status: res.status },
        502,
      );
    }

    c.var.log.info("tinybird_ingest_ok");
    return c.json({ ok: true, dataset, queued: true, count: rows.length }, 202);
  } catch (e) {
    return jsonError(c, e);
  }
});

export { tinybirdIngestRoutes };
