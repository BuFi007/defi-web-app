import { Hono } from "hono";
import { z } from "zod";

const marketsRoutes = new Hono();

const marketIdParam = z.string().min(1);

marketsRoutes.get("/", (c) => {
  // TODO: replace with @bufi/contracts + indexer query
  return c.json({ markets: [] });
});

marketsRoutes.get("/:marketId", (c) => {
  const id = marketIdParam.safeParse(c.req.param("marketId"));
  if (!id.success) return c.json({ error: "invalid marketId" }, 400);
  return c.json({ marketId: id.data, status: "stub" }, 501);
});

marketsRoutes.get("/:marketId/price", (c) => {
  const id = marketIdParam.safeParse(c.req.param("marketId"));
  if (!id.success) return c.json({ error: "invalid marketId" }, 400);
  return c.json({ marketId: id.data, price: null, source: null, ts: null }, 501);
});

marketsRoutes.get("/:marketId/candles", (c) => {
  const id = marketIdParam.safeParse(c.req.param("marketId"));
  if (!id.success) return c.json({ error: "invalid marketId" }, 400);
  return c.json({ marketId: id.data, candles: [] }, 501);
});

export { marketsRoutes };
