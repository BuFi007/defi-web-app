import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getVerifiedPlatforms } from "@/lib/kawaii/social";
import { guildConfigured, getGuildVerifiedPlatforms } from "@/lib/kawaii/guild";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/social/status?wallet=0x… → which socials this wallet has verified.
 *  Prefers Guild.xyz (free X-follow + Discord + Telegram oracle) when configured;
 *  otherwise falls back to our own OAuth ledger. `source` tells the gate which path. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });

  if (guildConfigured()) {
    const verified = await getGuildVerifiedPlatforms(wallet);
    return NextResponse.json({ verified, source: "guild" });
  }
  const verified = await getVerifiedPlatforms(wallet);
  return NextResponse.json({ verified, source: "oauth" });
}
