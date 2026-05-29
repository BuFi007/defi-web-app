import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { createHash, randomBytes } from "node:crypto";
import { OAUTH_PROVIDERS, redirectUri, signState, type Platform } from "@/lib/kawaii/social";

export const dynamic = "force-dynamic";

const b64url = (b: Buffer) => b.toString("base64url");

/** GET /api/kawaii/social/{discord|x}/start?wallet=0x… → redirect to OAuth authorize. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (platform !== "discord" && platform !== "x") {
    return NextResponse.json({ error: "unknown platform (telegram uses the login widget)" }, { status: 400 });
  }
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });

  const p = OAUTH_PROVIDERS[platform as Exclude<Platform, "telegram">];
  const clientId = p.clientId();
  if (!clientId) return NextResponse.json({ error: `${platform} OAuth not configured` }, { status: 501 });

  const url = new URL(p.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(platform as Platform));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("state", signState(wallet, platform as Platform, Math.floor(Date.now() / 1000)));

  let verifier: string | null = null;
  if (platform === "x") {
    // X requires PKCE (S256). Stash the verifier in an httpOnly cookie for the callback.
    verifier = b64url(randomBytes(32));
    url.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
    url.searchParams.set("code_challenge_method", "S256");
  }

  const res = NextResponse.redirect(url.toString());
  if (verifier) res.cookies.set("kawaii_x_pkce", verifier, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
