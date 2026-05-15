import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ALPHA_COOKIE_NAME = "bu_alpha_access";

const isSafePassword = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

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

  let body: unknown;
  try {
    body = await req.json();
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

  if (!isSafePassword(password) || password !== configuredPassword) {
    return NextResponse.json({ ok: false }, { status: 401 });
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
