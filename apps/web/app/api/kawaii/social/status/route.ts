import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getVerifiedPlatforms } from "@/lib/kawaii/social";

export const dynamic = "force-dynamic";

/** GET /api/kawaii/social/status?wallet=0x… → which socials this wallet has verified. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  const verified = await getVerifiedPlatforms(wallet);
  return NextResponse.json({ verified });
}
