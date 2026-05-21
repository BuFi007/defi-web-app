/**
 * Internal realtime publish route (Wave E6).
 *
 * Keeper / matcher / future-ponder-bridge POSTs an envelope here after a
 * settled match / book change / funding poke. This route serialises and
 * publishes to the corresponding Redis channel (or the in-process emitter
 * fallback) so every WS subscriber for that market sees the event.
 *
 * Auth: `X-Internal-Token` must match `INTERNAL_REALTIME_TOKEN`. When the
 * env var is unset the route refuses every request (so a half-configured
 * staging deploy doesn't accidentally accept anonymous fan-out writes).
 *
 * Wire shape — same as `RealtimeEnvelope` from `lib/realtime.ts`:
 *
 *   POST /internal/realtime/publish
 *   X-Internal-Token: <secret>
 *   Content-Type: application/json
 *   {
 *     "kind": "trades" | "book" | "funding",
 *     "marketId": "EUR-USD-PERP",
 *     "data": { ... channel-specific payload ... }
 *   }
 *
 * Server fills in `type`, `channel`, and re-emits the envelope so WS
 * clients see a canonical shape regardless of which publisher emitted it.
 */

import { Hono } from "hono";
import { z } from "zod";

import {
  REALTIME_CHANNEL_KINDS,
  buildEnvelope,
  realtimeChannel,
  type RealtimeChannelKind,
} from "../lib/realtime";
import { publishChannel } from "../lib/redis";

const realtimeRoutes = new Hono();

const publishRequest = z.object({
  kind: z.enum(REALTIME_CHANNEL_KINDS as unknown as [RealtimeChannelKind, ...RealtimeChannelKind[]]),
  marketId: z.string().min(1).max(64),
  // We don't validate `data` here — schema-by-kind narrowing is the
  // consumer's job (see lib/realtime.ts payload interfaces). Forwarding a
  // loosely-typed object lets the publisher roll forward independently of
  // the API redeploy cadence.
  data: z.record(z.unknown()),
});

realtimeRoutes.post("/publish", async (c) => {
  const expectedToken = process.env.INTERNAL_REALTIME_TOKEN;
  if (!expectedToken) {
    return c.json(
      { error: "internal realtime route disabled (no INTERNAL_REALTIME_TOKEN)" },
      503,
    );
  }
  const presented = c.req.header("x-internal-token");
  if (!presented || presented !== expectedToken) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  const parsed = publishRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "bad body", issues: parsed.error.issues },
      400,
    );
  }

  const { kind, marketId, data } = parsed.data;
  // We coerce `data` to the union here — type-narrowing on `kind` is the
  // consumer's responsibility. The publishing payload contract is "you sent
  // a shape that matches kind; we forward it verbatim".
  const envelope = buildEnvelope(
    kind,
    marketId,
    data as unknown as Parameters<typeof buildEnvelope>[2],
  );
  await publishChannel(realtimeChannel(kind, marketId), envelope);

  return c.json({ ok: true, channel: envelope.channel });
});

export { realtimeRoutes };
