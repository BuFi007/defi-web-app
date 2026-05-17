import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALPHA_COOKIE_NAME = "bu_alpha_access";
const MAX_BODY_BYTES = 1024;

const isSafePassword = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

// SHA-256 both sides to constant-length digests, then compare in constant
// time. This is length-blind (an attacker can't probe length via timing)
// and short-circuit-free (every byte is compared regardless of input).
const passwordsMatch = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
};

export const POST = async (req: Request) => {
  if (process.env.ALPHA_GATE_ENABLED !== "true") {
    return NextResponse.json({ ok: true });
  }

  const configuredPassword = process.env.ALPHA_GATE_PASSWORD;
  if (!configuredPassword) {
    return NextResponse.json(
      { ok: false, error: "Alpha gate is not configured" },
      { status: 503 },
    );
  }

  // Read raw body and cap before any JSON.parse. Refuses 100MB upload
  // floods that would otherwise force Node to buffer the whole payload.
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Payload too large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request" },
      { status: 400 },
    );
  }

  const password =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).password
      : undefined;

  if (!isSafePassword(password) || !passwordsMatch(password, configuredPassword)) {
    return NextResponse.json({ ok: false });
  }

  const cookieStore = await cookies();
  cookieStore.set(ALPHA_COOKIE_NAME, "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  return NextResponse.json({ ok: true });
};
