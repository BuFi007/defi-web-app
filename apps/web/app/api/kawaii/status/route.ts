import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/status?wallet=0x… — does this wallet hold a Kawaii Punk?
 *  Sourced from our mint ledger (we control minting). Drives the gate overlay. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  const mint = await prisma.mint.findFirst({ where: { address: wallet.toLowerCase() }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ hasNft: !!mint, tier: mint?.tier ?? null });
}
