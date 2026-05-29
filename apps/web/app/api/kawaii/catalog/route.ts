import { NextResponse } from "next/server";
import { listLayerCatalog } from "@/lib/kawaii/layers";
import { RESERVED_BASES } from "@/lib/kawaii/config";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/catalog — open base filenames + reserved bases (display only,
 *  NO owner wallets exposed). Server-side (reads KAWAII_LAYERS_DIR). */
export function GET() {
  const open = listLayerCatalog().base ?? [];
  const reserved = Object.fromEntries(
    Object.entries(RESERVED_BASES).map(([k, v]) => [k, { display: v.display, platform: v.platform, claimUrl: v.claimUrl, mock: v.mock }]),
  );
  return NextResponse.json({ open, reserved });
}
