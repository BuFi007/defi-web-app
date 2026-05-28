import { NextResponse } from "next/server";

/**
 * Voice realtime relay — STUB.
 *
 * The voice client (hooks/realtime-open-ai/use-realtime-client.tsx) connects
 * here by default to keep the OpenAI API key on the server. Until the actual
 * relay is implemented (WebSocket bridge that forwards to OpenAI's realtime
 * API server-side), this route returns 501 so callers get a loud, debuggable
 * failure instead of silently falling back to "ship the API key to the
 * browser".
 *
 * To enable browser-direct mode for local dev, set:
 *   NEXT_PUBLIC_VOICE_DIRECT_MODE=1
 * and place a session-scoped API key in sessionStorage under
 *   tmp::voice_api_key
 * (clears on tab close — never use this in production).
 */
const NOT_IMPLEMENTED = {
  error: "voice_relay_not_implemented",
  message:
    "The /api/voice/realtime relay is not wired yet. Set NEXT_PUBLIC_VOICE_DIRECT_MODE=1 for dev-only browser-direct mode, or implement this route.",
};

export function GET() {
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

export function POST() {
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}
