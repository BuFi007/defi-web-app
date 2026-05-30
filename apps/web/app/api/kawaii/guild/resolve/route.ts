import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { resolveGuildIds, KAWAII_GUILD_URLNAME } from "@/lib/kawaii/guild";

export const dynamic = "force-dynamic";

/**
 * GET /api/kawaii/guild/resolve?wallet=0x… — one-step Guild activation helper.
 *
 * Guild's v2 guilds are UUID-keyed but the access layer is NUMERIC; the numeric
 * guildId + roleIds only become queryable once a wallet has JOINED the guild.
 * Join guild.xyz/kawaii-punks with this wallet, hit this route, and it returns
 * the exact env to set:
 *   KAWAII_GUILD_ID=<guildId>
 *   KAWAII_GUILD_ROLE_MAP={"<roleId>":["x","discord"]}
 * Then /api/kawaii/social/status flips to source:"guild". Read-only (public
 * Guild data); safe to expose.
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  try {
    const memberships = await resolveGuildIds(wallet);
    if (!memberships?.length) {
      return NextResponse.json({
        joined: false,
        note: `No Guild memberships for ${wallet}. Join https://guild.xyz/${KAWAII_GUILD_URLNAME} with this wallet (connect X + Discord) first, then retry.`,
      });
    }
    return NextResponse.json({
      joined: true,
      memberships,
      hint: "Set KAWAII_GUILD_ID to the guildId for kawaii-punks and KAWAII_GUILD_ROLE_MAP to {\"<roleId>\":[\"x\",\"discord\"]} for its roleIds.",
    });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // Guild returns 404 for a wallet with no Guild profile → it just hasn't joined.
    if (/not found|404/i.test(msg)) {
      return NextResponse.json({
        joined: false,
        note: `${wallet} has no Guild profile yet. Join https://guild.xyz/${KAWAII_GUILD_URLNAME} with this wallet (connect X + Discord), then retry.`,
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
