import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const MAX_BODY_BYTES = 1024 * 1024;

const getDynamicSignature = (request: NextRequest) =>
  request.headers.get("x-dynamic-signature-256") ??
  request.headers.get("x-dynamic-signature");

const verifyDynamicSignature = ({
  rawBody,
  secret,
  signature,
}: {
  rawBody: string;
  secret: string;
  signature: string;
}) => {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const trusted = Buffer.from(`sha256=${digest}`, "ascii");
  const untrusted = Buffer.from(signature, "ascii");

  return (
    trusted.length === untrusted.length && timingSafeEqual(trusted, untrusted)
  );
};

const getStringField = (payload: unknown, field: string) => {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
};

// Webhook endpoint is POST-only. Reject everything else with a proper 405
// so the surface doesn't fingerprint the service to scanners.
export const GET = () =>
  new NextResponse(null, { status: 405, headers: { Allow: "POST" } });

export const POST = async (request: NextRequest) => {
  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const webhookSecret = process.env.DYNAMIC_WEBHOOK_SECRET;
  const signature = getDynamicSignature(request);

  if (webhookSecret) {
    if (
      !signature ||
      !verifyDynamicSignature({ rawBody, secret: webhookSecret, signature })
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Webhook secret is not configured" },
      { status: 500 },
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const eventName =
    getStringField(payload, "eventName") ??
    getStringField(payload, "event") ??
    getStringField(payload, "type") ??
    "unknown";
  const eventId =
    getStringField(payload, "eventId") ??
    getStringField(payload, "id") ??
    "unknown";

  console.info("[dynamic-webhook] received", { eventId, eventName });

  return NextResponse.json({ received: true });
};
