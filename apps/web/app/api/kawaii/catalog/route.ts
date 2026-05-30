import { NextResponse } from "next/server";
import { listLayerCatalog } from "@/lib/kawaii/layers";
import { RESERVED_BASES, KAWAII_TRAIT_ORDER } from "@/lib/kawaii/config";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/catalog — open base filenames + reserved bases (display only,
 *  NO owner wallets exposed) + the cosmetic trait catalog per category (drives
 *  the power-gated wardrobe). Server-side (reads KAWAII_LAYERS_DIR). */
export function GET() {
  const full = listLayerCatalog();
  const open = full.base ?? [];
  const reserved = Object.fromEntries(
    Object.entries(RESERVED_BASES).map(([k, v]) => [k, { display: v.display, platform: v.platform, claimUrl: v.claimUrl, mock: v.mock }]),
  );
  // Only the cosmetic trait categories (base/background handled separately).
  const traits = Object.fromEntries(KAWAII_TRAIT_ORDER.map((cat) => [cat, full[cat] ?? []]));
  return NextResponse.json({ open, reserved, traits });
}
