import { NextResponse } from "next/server";

import { runAllProbes } from "@/lib/status/probes";

/**
 * JSON status endpoint — mirrors the page state for monitoring tools
 * (status.io, BetterStack, Grafana, Slack bots) that want a machine-
 * readable feed instead of scraping HTML.
 *
 * Contract:
 *   GET /api/status
 *   → 200 OK
 *     {
 *       generatedAt: "2026-...",
 *       overall: "operational" | "degraded" | "down",
 *       results: [
 *         { service: {...}, status, latencyMs, checkedAt, message, details? },
 *         ...
 *       ]
 *     }
 *
 * Caching:
 *   `revalidate = 30` matches the page so the JSON and HTML can't drift
 *   apart in the same render window. The route also sets `Cache-Control`
 *   so CDNs in front of Vercel (eventually status.bu.finance →
 *   Cloudflare) honour the same window.
 *
 * HTTP status code:
 *   The endpoint always returns HTTP 200 with the overall status inside
 *   the body. Monitoring tools should switch on `body.overall`, not on
 *   the HTTP code — a 500 here would be ambiguous (is the status page
 *   down, or are the services it monitors down?). The status page itself
 *   being reachable IS the signal.
 */

export const revalidate = 30;

export async function GET() {
  const snapshot = await runAllProbes();
  return NextResponse.json(snapshot, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=15, stale-while-revalidate=30",
      // Allow Slack bots / external monitors hosted off-domain to fetch this
      // without a CORS preflight failure.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}
