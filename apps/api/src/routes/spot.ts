import { Hono } from "hono";

import { buildVenueSpotIntent, spotIntentRequestSchema } from "@bufi/fx-spot";

import type { WalletSession } from "@bufi/shared-types";

import { errorStatus, jsonSafe } from "../services";

const spotRoutes = new Hono();

spotRoutes.post("/intents", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = spotIntentRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  if (parsed.data.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  try {
    const built = buildVenueSpotIntent(parsed.data);
    return c.json(
      jsonSafe({
        routeId: built.routeId,
        router: built.router,
        digest: built.digest,
        typedData: built.typedData,
        calldata: built.calldata,
      }),
    );
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

export { spotRoutes };
