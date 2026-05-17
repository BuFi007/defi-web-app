import { Hono } from "hono";

import { receiptStore } from "../services";

const x402Routes = new Hono();

x402Routes.get("/receipts", async (c) => {
  const payer = c.req.query("payer");
  const all = await receiptStore.list({ payer });
  return c.json({ receipts: all });
});

x402Routes.get("/verify", async (c) => {
  const receiptId = c.req.query("receiptId");
  if (!receiptId) return c.json({ error: "receiptId query param required" }, 400);
  const has = await receiptStore.has(receiptId);
  return c.json({ receiptId, settled: has });
});

export { x402Routes };
