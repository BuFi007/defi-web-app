import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { verifyTelegramAuth, markVerified } from "@/lib/kawaii/social";

export const dynamic = "force-dynamic";

/** POST /api/kawaii/social/telegram/verify — Telegram Login Widget payload + wallet.
 *  Verifies the widget HMAC, then (if TELEGRAM_CHAT_ID set) checks group/channel membership. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string> & { wallet?: string };
  const { wallet, ...auth } = body;
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  if (!verifyTelegramAuth(auth)) return NextResponse.json({ error: "telegram auth invalid" }, { status: 401 });

  const chatId = process.env.TELEGRAM_CHAT_ID;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (chatId && token && auth.id) {
    const r = (await (await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${chatId}&user_id=${auth.id}`)).json()) as {
      ok?: boolean; result?: { status?: string };
    };
    const member = r.ok && ["creator", "administrator", "member"].includes(r.result?.status ?? "");
    if (!member) return NextResponse.json({ error: "not a member — join the Telegram first" }, { status: 403 });
  }

  await markVerified(wallet, "telegram", auth.id, auth.username);
  return NextResponse.json({ ok: true });
}
