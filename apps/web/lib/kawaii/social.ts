import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";

/**
 * Social-requisite OAuth for the Kawaii gate (Discord + X via OAuth2 code flow,
 * Telegram via Login Widget). Verifications are stored per (wallet, platform) in
 * social_verifications; the mint route requires testnet = all 3, mainnet = X + one.
 *
 * REQUIRED ENV to activate (none are committed):
 *   APP_URL                      e.g. https://fx.bu.finance (OAuth redirect base)
 *   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_GUILD_ID (membership check)
 *   X_CLIENT_ID / X_CLIENT_SECRET / X_FOLLOW_TARGET_ID (follow check, needs follows.read)
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (getChatMember check)
 *   (state HMAC reuses KAWAII_ATTEST_SECRET)
 */
export type Platform = "discord" | "telegram" | "x";

export const OAUTH_PROVIDERS = {
  discord: {
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify guilds",
    clientId: () => process.env.DISCORD_CLIENT_ID,
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
  },
  x: {
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scope: "users.read tweet.read follows.read",
    clientId: () => process.env.X_CLIENT_ID,
    clientSecret: () => process.env.X_CLIENT_SECRET,
  },
} as const;

export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

export function redirectUri(platform: Platform): string {
  return `${appUrl()}/api/kawaii/social/${platform}/callback`;
}

function stateSecret(): string {
  const s = process.env.KAWAII_ATTEST_SECRET;
  if (!s) throw new Error("KAWAII_ATTEST_SECRET missing (used for OAuth state HMAC)");
  return s;
}

/** Signed OAuth state binding the flow to a wallet (prevents cross-wallet verify). */
export function signState(wallet: string, platform: Platform, nowSeconds: number): string {
  const payload = `${wallet.toLowerCase()}.${platform}.${nowSeconds}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string): { wallet: string; platform: Platform } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [wallet, platform, ts, sig] = decoded.split(".");
    if (!wallet || !platform || !ts || !sig) return null;
    const expected = createHmac("sha256", stateSecret()).update(`${wallet}.${platform}.${ts}`).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Date.now() / 1000 - Number(ts) > 900) return null; // 15-min state TTL
    return { wallet, platform: platform as Platform };
  } catch {
    return null;
  }
}

export async function markVerified(wallet: string, platform: Platform, externalId?: string, handle?: string) {
  const address = wallet.toLowerCase();
  await prisma.socialVerification.upsert({
    where: { address_platform: { address, platform } },
    update: { verified: true, verifiedAt: new Date(), externalId, handle },
    create: { address, platform, verified: true, verifiedAt: new Date(), externalId, handle },
  });
}

export async function getVerifiedPlatforms(wallet: string): Promise<Platform[]> {
  const rows = await prisma.socialVerification.findMany({ where: { address: wallet.toLowerCase(), verified: true } });
  return rows.map((r) => r.platform as Platform);
}

/** Verify a Telegram Login Widget payload (HMAC-SHA256 over the data-check-string). */
export function verifyTelegramAuth(data: Record<string, string>): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const { hash, ...rest } = data;
  if (!hash) return false;
  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest(); // Login Widget secret_key = SHA256(bot_token)
  const hmac = createHmac("sha256", secret).update(checkString).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
