import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

// Same input-clamp pattern as /api/[id] — narrow the cache key space so
// querystring fuzzing can't burn unbounded edge renders.
const TOKEN_PATTERN = /^[A-Z0-9]{1,8}$/;
const ALLOWED_CHAINS = new Set([
  "1", "10", "56", "100", "137", "8453", "42161", "43113", "43114", "1301", "4801", "5042002", "11155111", "84532",
]);

function sanitizeAmount(raw: string | null): string {
  if (!raw) return "0";
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return "0";
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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const amount = sanitizeAmount(searchParams.get("amount"));
  const token = sanitizeToken(searchParams.get("token"));
  // Sanitize chain even though it's not visually used yet.
  sanitizeChain(searchParams.get("chain"));

  const baseUrl = origin;

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
          src={`${baseUrl}/images/iso-logo.png`}
          alt="Bu.fi"
          width="128"
          height="128"
        />
        <h1 style={{ fontSize: 60, margin: "20px 0" }}>¡Reclama Tus Tokens!</h1>
        <h2 style={{ fontSize: 48, margin: "0 0 20px" }}>
          {amount} {token}
        </h2>
        <p style={{ fontSize: 32, color: "#666" }}>
          Alguien te envió tokens en Bu.fi
        </p>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
