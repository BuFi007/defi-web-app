import { NextRequest, NextResponse } from "next/server";
import { OAUTH_PROVIDERS, redirectUri, verifyState, markVerified, appUrl, type Platform } from "@/lib/kawaii/social";

export const dynamic = "force-dynamic";

function done(ok: boolean, platform: string, detail = "") {
  const u = new URL("/", appUrl());
  u.searchParams.set("kawaii_social", ok ? "verified" : "failed");
  u.searchParams.set("platform", platform);
  if (detail) u.searchParams.set("detail", detail);
  return NextResponse.redirect(u.toString());
}

/** GET /api/kawaii/social/{discord|x}/callback?code&state */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (platform !== "discord" && platform !== "x") return done(false, platform, "unknown");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return done(false, platform, "missing code/state");
  const parsed = verifyState(state);
  if (!parsed || parsed.platform !== platform) return done(false, platform, "bad state");
  const wallet = parsed.wallet;

  const p = OAUTH_PROVIDERS[platform as Exclude<Platform, "telegram">];
  const clientId = p.clientId()!;
  const clientSecret = p.clientSecret()!;

  try {
    // ---- token exchange ----
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(platform as Platform),
      client_id: clientId,
    });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (platform === "discord") {
      form.set("client_secret", clientSecret);
    } else {
      // X: PKCE verifier from cookie + Basic auth (confidential client)
      const verifier = req.cookies.get("kawaii_x_pkce")?.value;
      if (!verifier) return done(false, platform, "missing pkce");
      form.set("code_verifier", verifier);
      headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    }
    const tokRes = await fetch(p.tokenUrl, { method: "POST", headers, body: form });
    if (!tokRes.ok) return done(false, platform, "token exchange failed");
    const { access_token } = (await tokRes.json()) as { access_token: string };

    // ---- identity + membership/follow ----
    let externalId = "";
    let handle = "";
    let memberOk = true;

    if (platform === "discord") {
      const me = await (await fetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${access_token}` } })).json();
      externalId = me.id;
      handle = me.username;
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const guilds = (await (await fetch("https://discord.com/api/users/@me/guilds", { headers: { authorization: `Bearer ${access_token}` } })).json()) as Array<{ id: string }>;
        memberOk = Array.isArray(guilds) && guilds.some((g) => g.id === guildId);
      }
    } else {
      const me = (await (await fetch("https://api.twitter.com/2/users/me", { headers: { authorization: `Bearer ${access_token}` } })).json()) as { data?: { id: string; username: string } };
      externalId = me.data?.id ?? "";
      handle = me.data?.username ?? "";
      const target = process.env.X_FOLLOW_TARGET_ID;
      if (target && externalId) {
        // follows.read: page through /following looking for the target.
        const f = (await (await fetch(`https://api.twitter.com/2/users/${externalId}/following?max_results=1000`, { headers: { authorization: `Bearer ${access_token}` } })).json()) as { data?: Array<{ id: string }> };
        memberOk = Array.isArray(f.data) && f.data.some((u) => u.id === target);
      }
    }

    if (!memberOk) return done(false, platform, platform === "discord" ? "not in guild" : "not following");

    await markVerified(wallet, platform as Platform, externalId, handle);
    const res = done(true, platform);
    if (platform === "x") res.cookies.delete("kawaii_x_pkce");
    return res;
  } catch {
    return done(false, platform, "callback error");
  }
}
