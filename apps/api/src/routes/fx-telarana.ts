import { Hono } from "hono";
import { z } from "zod";

import type { WalletSession } from "@bufi/shared-types";

const fxTelaranaRoutes = new Hono();

const quoteBody = z.object({
  chainId: z.union([z.literal(43113), z.literal(919), z.literal(5042002)]),
  marketId: z.string().min(1),
  collateralAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  borrowAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

const intentBody = quoteBody.extend({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deadline: z.number().int(),
});

fxTelaranaRoutes.get("/markets", (c) => c.json({ markets: [] }));

fxTelaranaRoutes.post("/borrow/quote", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = quoteBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  return c.json(
    {
      ...parsed.data,
      borrowApyBps: 0,
      collateralFactorBps: 0,
      healthFactorBps: 0,
    },
    501,
  );
});

fxTelaranaRoutes.post("/borrow/intents", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = intentBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  if (parsed.data.borrower.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "borrower must match session address" }, 403);
  }
  return c.json({ intentId: "stub", digest: "0x" }, 501);
});

fxTelaranaRoutes.get("/positions/:address", (c) =>
  c.json({ address: c.req.param("address"), positions: [] }),
);

export { fxTelaranaRoutes };
