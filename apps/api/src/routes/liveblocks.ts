import { Hono } from "hono";
import { z } from "zod";

import { authorizeLiveblocksRoom, buildRoomPermissions } from "@bufi/liveblocks";

import type { WalletSession } from "@bufi/shared-types";

const authBody = z.object({
  marketIds: z.array(z.string()).optional(),
  arcadeRoomIds: z.array(z.string()).optional(),
  telaranaMarketIds: z.array(z.string()).optional(),
  mcpWorkflowIds: z.array(z.string()).optional(),
});

export const liveblocksRoutes = new Hono();

liveblocksRoutes.post("/auth", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = authBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid request body", issues: parsed.error.issues }, 400);
  }

  const roomIds = buildRoomPermissions({
    chainId: session.chainId,
    marketIds: parsed.data.marketIds,
    arcadeRoomIds: parsed.data.arcadeRoomIds,
    telaranaMarketIds: parsed.data.telaranaMarketIds,
    mcpWorkflowIds: parsed.data.mcpWorkflowIds,
  });

  try {
    const issued = await authorizeLiveblocksRoom({
      address: session.address,
      chainId: session.chainId,
      roomIds,
      role: "trader",
    });
    return c.json(issued);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
