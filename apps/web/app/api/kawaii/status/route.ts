import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/status?wallet=0x… — does this wallet hold a Kawaii Punk?
 *  Sourced from our mint ledger (we control minting). Drives the gate overlay. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  const lc = wallet.toLowerCase();
  const [mint, wl] = await Promise.all([
    prisma.mint.findFirst({ where: { address: lc }, orderBy: { createdAt: "desc" } }),
    prisma.gateWhitelist.findUnique({ where: { address: lc } }),
  ]);
  return NextResponse.json({
    hasNft: !!mint,
    tier: mint?.tier ?? null,
    baseId: mint?.baseId ?? null,
    tokenId: mint?.tokenId ?? null,
    agentId: mint?.agentId ?? null, // ERC-8004 badge → render the AGENT corner stamp
    ipfsCid: mint?.ipfsCid ?? null, // live metadata CID → "View on IPFS" deep link
    mintedAt: mint?.createdAt ?? null,
    whitelisted: !!wl, // whitelist waives PAYMENT only (socials still required) → Free Mint
  });
}
