import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@bufi/location/supported-locales";

export const runtime = "edge";

// Edge OG generator. Locale comes from the NEXT_LOCALE cookie. All query
// params are aggressively clamped so cache-buster attacks can't fan out
// to infinite distinct edge renders.
const LOADERS: Record<
  SupportedLocale,
  () => Promise<{ default: { OpenGraphClaim: Record<string, string> } }>
> = {
  en: () => import("@/messages/en.json"),
  es: () => import("@/messages/es.json"),
  pt: () => import("@/messages/pt.json"),
  ja: () => import("@/messages/ja.json"),
  ko: () => import("@/messages/ko.json"),
};

// Tight whitelists so an attacker can't mint unique cache keys forever.
const TOKEN_PATTERN = /^[A-Z0-9]{1,8}$/;
const ALLOWED_CHAINS = new Set([
  "1", "10", "56", "100", "137", "8453", "42161", "43113", "43114", "1301", "4801", "5042002", "11155111", "84532",
]);

function sanitizeAmount(raw: string | null): string {
  if (!raw) return "0";
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return "0";
  // Cap precision so "0.000…001" and "0.000…002" don't generate distinct keys.
  return num.toFixed(2);
}

function sanitizeToken(raw: string | null): string {
  if (!raw) return "ETH";
  return TOKEN_PATTERN.test(raw) ? raw : "ETH";
}

function sanitizeChain(raw: string | null): string {
  if (!raw) return "1";
  return ALLOWED_CHAINS.has(raw) ? raw : "1";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // Reject pathologically long ids so they can't be used as cache-buster fodder.
  if (!rawId || rawId.length > 64) {
    return new Response("Invalid id", { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const amount = sanitizeAmount(searchParams.get("amount"));
  const token = sanitizeToken(searchParams.get("token"));
  // `chain` is read for future use; included in the sanitization pass so
  // the eventual switch from text-only OG to chain-themed OG is drop-in.
  sanitizeChain(searchParams.get("chain"));

  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale: SupportedLocale =
    cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)
      ? (cookieLocale as SupportedLocale)
      : DEFAULT_LOCALE;

  const messages = (await LOADERS[locale]()).default.OpenGraphClaim;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "white",
          padding: "40px",
        }}
      >
        <img
          src={`${process.env.NEXT_PUBLIC_URL}/images/iso-logo.png`}
          alt="Bu.fi"
          width="128"
          height="128"
        />
        <h1 style={{ fontSize: 60, margin: "20px 0" }}>
          {messages.paymentRequest}
        </h1>
        <h2 style={{ fontSize: 48, margin: "0 0 20px" }}>
          {amount} {token}
        </h2>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // 24h CDN cache so even unique-looking URLs hit the edge cache.
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
