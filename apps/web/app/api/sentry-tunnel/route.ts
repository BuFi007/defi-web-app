/**
 * Sentry tunnel route.
 *
 * Browser SDK envelopes are POSTed here instead of directly to
 * `sentry.io`. The handler re-emits them to the ingest endpoint
 * server-side so ad-blockers + privacy extensions (which routinely
 * block `*.sentry.io`) can't strip our error telemetry.
 *
 * Pattern: https://docs.sentry.io/platforms/javascript/troubleshooting/#dealing-with-ad-blockers
 *
 * Hardening:
 *   - We only forward envelopes whose DSN host matches the
 *     server-known `SENTRY_DSN_WEB`. An attacker can't repurpose this
 *     route as an open proxy.
 *   - We only forward to the exact project ID encoded in our DSN.
 *   - On any parse failure we return 204 — never 5xx — so the SDK
 *     stops retrying broken envelopes.
 *
 * Note: route segment config (`runtime`, `dynamic`) is intentionally
 * omitted — Next 16's `cacheComponents` mode rejects those exports.
 * POST handlers are inherently dynamic in App Router anyway.
 */

type ParsedDsn = {
  host: string;
  projectId: string;
};

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.hostname || !projectId) return null;
    return { host: url.hostname, projectId };
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return new Response(null, { status: 204 });

  const parsed = parseDsn(dsn);
  if (!parsed) return new Response(null, { status: 204 });

  let envelope: string;
  try {
    envelope = await req.text();
  } catch {
    return new Response(null, { status: 204 });
  }

  // The envelope's first line is a JSON header: { dsn: "..." , ... }.
  // We pin the destination to OUR DSN; we never relay to a host the
  // client picks.
  const newlineIdx = envelope.indexOf("\n");
  if (newlineIdx === -1) return new Response(null, { status: 204 });

  let header: { dsn?: string };
  try {
    header = JSON.parse(envelope.slice(0, newlineIdx)) as { dsn?: string };
  } catch {
    return new Response(null, { status: 204 });
  }

  // If the envelope was forged against another DSN, reject silently.
  if (header.dsn) {
    const inbound = parseDsn(header.dsn);
    if (
      !inbound ||
      inbound.host !== parsed.host ||
      inbound.projectId !== parsed.projectId
    ) {
      return new Response(null, { status: 204 });
    }
  }

  const upstream = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;

  try {
    const res = await fetch(upstream, {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });
    // Mirror upstream status so SDK retry logic stays accurate, but
    // we never expose the body — keeps logs clean.
    return new Response(null, { status: res.status });
  } catch {
    return new Response(null, { status: 204 });
  }
}
