import { Hono } from "hono";

import { borrowIntentRequest, borrowQuoteRequest } from "@bufi/fx-telarana";

import type { WalletSession } from "@bufi/shared-types";

import { errorStatus, telaranaService } from "../services";

const fxTelaranaRoutes = new Hono();

fxTelaranaRoutes.get("/markets", async (c) => {
  const chainId = Number(c.req.query("chainId") ?? 5042002);
  return c.json({ markets: await telaranaService.listMarkets(chainId) });
});

fxTelaranaRoutes.post("/borrow/quote", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = borrowQuoteRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await telaranaService.borrowQuote(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxTelaranaRoutes.post("/borrow/intents", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = borrowIntentRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  if (parsed.data.borrower.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "borrower must match session address" }, 403);
  }
  try {
    return c.json(await telaranaService.createBorrowIntent(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxTelaranaRoutes.get("/positions/:address", async (c) =>
  c.json({ address: c.req.param("address"), positions: await telaranaService.positionsFor(c.req.param("address")) }),
);

export { fxTelaranaRoutes };
