import { Hono } from "hono";

import { createInMemoryReceiptStore } from "@bufi/x402";

const x402Routes = new Hono();

// Same shared store the middleware writes to. Swap for Postgres later.
const receipts = createInMemoryReceiptStore();

x402Routes.get("/receipts", async (c) => {
  const payer = c.req.query("payer");
  const all = await receipts.list({ payer });
  return c.json({ receipts: all });
});

x402Routes.get("/verify", async (c) => {
  const receiptId = c.req.query("receiptId");
  if (!receiptId) return c.json({ error: "receiptId query param required" }, 400);
  const has = await receipts.has(receiptId);
  return c.json({ receiptId, settled: has });
});

export { x402Routes };
