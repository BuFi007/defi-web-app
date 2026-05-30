import { createGuildClient } from "@guildxyz/sdk";
import type { Platform } from "./social";
import { KAWAII_GUILD_URLNAME, KAWAII_GUILD_UUID } from "./config";

export { KAWAII_GUILD_URLNAME, KAWAII_GUILD_UUID };

/**
 * Guild.xyz as the FREE social-verification oracle for the Kawaii gate.
 *
 * Why: X killed free follow verification (follows.read = paid ~$100/mo). Guild
 * runs the X-follow + Discord-join checks on THEIR side and we read the result
 * by wallet address — free, no deposit, no X bill. We keep all on-chain truth
 * (SIWE, payment, NFT on Arc) in our own code; Guild only proves socials.
 *
 * Flow: user joins guild.xyz/kawaii-punks (connects wallet + X/Discord once,
 * Guild verifies the requirements, grants the role) → our gate calls
 * user.getMemberships(address) (public, no signer) → if they hold a role in our
 * guild, the qualifying socials are proven. Fails SAFE to [] (a downed Guild or
 * a non-member never errors the gate; they just show unverified).
 *
 * ALWAYS-ON: the guild is identified by its urlName/UUID (committed constants),
 * resolved at runtime — no env wiring needed. The kawaii-punks guild bundles
 * X-follow + Discord-join into its role, so holding any role there = both
 * socials proven. Env overrides remain for finer-grained per-role mapping.
 */
const client = createGuildClient("bufi-kawaii");

// The socials the kawaii-punks guild gates on (its role bundles both).
const GUILD_PLATFORMS: Platform[] = ["x", "discord"];

// Cache the resolved guild ids (the v2 guild is UUID-keyed; getMemberships may
// report either the UUID or a legacy numeric id, so we match against all known).
let cachedIds: Set<string> | null = null;
async function guildIds(): Promise<Set<string>> {
  if (cachedIds) return cachedIds;
  const ids = new Set<string>([KAWAII_GUILD_UUID]);
  if (process.env.KAWAII_GUILD_ID) ids.add(String(process.env.KAWAII_GUILD_ID));
  try {
    const g = await client.guild.get(KAWAII_GUILD_URLNAME);
    if (g?.id) ids.add(String(g.id));
    const legacy = (g as { legacyId?: number | null })?.legacyId;
    if (legacy != null) ids.add(String(legacy));
  } catch {
    /* keep the constant ids */
  }
  cachedIds = ids;
  return ids;
}

function roleMap(): Record<string, Platform[]> {
  try {
    return JSON.parse(process.env.KAWAII_GUILD_ROLE_MAP || "{}") as Record<string, Platform[]>;
  } catch {
    return {};
  }
}

/** Always true — Guild is the oracle (resolved from the committed urlName/UUID). */
export function guildConfigured(): boolean {
  return true;
}

/** Which socials this wallet has proven via Guild (a granted role in our guild). */
export async function getGuildVerifiedPlatforms(address: string): Promise<Platform[]> {
  try {
    const ids = await guildIds();
    const memberships = await client.user.getMemberships(address.toLowerCase());
    const mine = memberships.filter((m) => ids.has(String(m.guildId)));
    if (!mine.length) return []; // not a member of our guild yet
    const map = roleMap();
    // If an explicit role→platform map is set, honor it; otherwise any held role
    // in our guild means the bundled X+Discord requirements were satisfied.
    if (Object.keys(map).length > 0) {
      const out = new Set<Platform>();
      for (const m of mine) for (const roleId of m.roleIds ?? []) for (const p of map[String(roleId)] ?? []) out.add(p);
      return [...out];
    }
    const hasRole = mine.some((m) => (m.roleIds ?? []).length > 0);
    return hasRole ? [...GUILD_PLATFORMS] : [];
  } catch {
    return []; // 404 (no Guild profile) / network → fail safe (shows unverified)
  }
}

/** The public join URL — where the gate sends users to verify their socials. */
export function guildJoinUrl(): string {
  return `https://guild.xyz/${KAWAII_GUILD_URLNAME}`;
}

/**
 * One-time helper to inspect a wallet's memberships (debug /guild/resolve route).
 */
export async function resolveGuildIds(joinedAddress: string) {
  return client.user.getMemberships(joinedAddress.toLowerCase());
}
