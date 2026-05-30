import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { computePower } from "@/lib/kawaii/power";

export const dynamic = "force-dynamic";

/**
 * GET /api/kawaii/power?wallet=0x… — the wallet's Kawaii "power", read live from
 * the Envio indexer (perp + spot notional + Bento). Power unlocks layered traits
 * (KAWAII_TRAIT_TIERS) and is the single source of truth the wardrobe, Galxe
 * credentials, and the leaderboard all read. Fails safe to 0 if Envio is down.
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  const p = await computePower(wallet);
  return NextResponse.json(p);
}
