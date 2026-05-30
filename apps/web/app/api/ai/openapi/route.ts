import { NextResponse } from "next/server";

/**
 * Same-origin proxy for the BUFI HYPER MCP OpenAPI spec.
 *
 * The renderer (Scalar, on /ai/reference) fetches the spec client-side. The MCP
 * serves /openapi.json without CORS headers and on a different origin
 * (mcp.bu.finance ≠ the web origin), so a direct browser fetch is blocked.
 * Proxying it server-side keeps the renderer pointed at a same-origin URL and
 * the MCP's live spec the single source of truth. Cached for an hour.
 */
const UPSTREAM = "https://mcp.bu.finance/openapi.json";
export const revalidate = 3600;

export async function GET() {
  try {
    const r = await fetch(UPSTREAM, { next: { revalidate: 3600 } });
    if (!r.ok) return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    const spec = await r.text();
    return new NextResponse(spec, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
