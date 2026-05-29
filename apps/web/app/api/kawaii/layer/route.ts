import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolveLayerPath } from "@/lib/kawaii/layers";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/layer?cat=base&file=base_xxx.png — serve a layer PNG for the
 *  picker thumbnails. resolveLayerPath allowlists (cat, file) against the on-disk
 *  catalog → no path traversal. */
export function GET(req: NextRequest) {
  const cat = req.nextUrl.searchParams.get("cat") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const p = resolveLayerPath(cat, file);
  if (!p) return new Response("not found", { status: 404 });
  const buf = readFileSync(p);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, immutable" },
  });
}
