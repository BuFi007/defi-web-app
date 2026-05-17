import { Hono } from "hono";

import {
  PERPS_REPLACEMENT_NEEDED_EVENT,
  perpsIntentRequest,
  perpsQuoteRequest,
  perpsReplacementPrepareRequest,
  perpsReplacementSubmitRequest,
  reconcilePerpsIntentWithSettlements,
} from "@bufi/perps";
import { paymentRequired } from "@bufi/x402";

import type { WalletSession } from "@bufi/shared-types";

import {
  errorStatus,
  jsonSafe,
  paymentVerifier,
  perpsService,
  perpsSettlementReader,
  receiptStore,
  tradingDb,
} from "../services";

const perpsRoutes = new Hono();

const sellerForX402 = () =>
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

perpsRoutes.get("/markets", async (c) => {
  const chainId = Number(c.req.query("chainId") ?? 5042002);
  return c.json({ markets: await perpsService.listMarkets(chainId) });
});

perpsRoutes.post("/quote", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsQuoteRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await perpsService.quote(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.use(
  "/quote/premium",
  paymentRequired({
    toolName: "bufx.quote.perp.premium",
    priceUsdc: "0.0010",
    sellerAddress: sellerForX402(),
    verifier: paymentVerifier,
    receipts: receiptStore,
  }),
);
perpsRoutes.post("/quote/premium", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsQuoteRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json({ premium: true, quote: await perpsService.quote(parsed.data) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.post("/intents", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsIntentRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  if (parsed.data.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  try {
    return c.json(jsonSafe(await perpsService.createIntent(parsed.data)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.get("/replacement-needed", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const after = c.req.query("after") ? Number(c.req.query("after")) : undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (after !== undefined && !Number.isFinite(after)) {
    return c.json({ error: "after must be a unix timestamp" }, 400);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }
  const events = await tradingDb.events.list({
    type: PERPS_REPLACEMENT_NEEDED_EVENT,
    actor: session.address,
    after,
    limit,
  });
  return c.json(jsonSafe({ events }));
});

perpsRoutes.post("/intents/:id/replacement/prepare", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const originalIntentId = c.req.param("id");
  const original = await perpsService.getIntent(originalIntentId);
  if (!original) return c.json({ error: "intent not found" }, 404);
  if (original.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsReplacementPrepareRequest.safeParse({ ...raw, originalIntentId });
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(jsonSafe(await perpsService.prepareReplacementIntent(parsed.data)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.post("/intents/:id/replacement", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const originalIntentId = c.req.param("id");
  const original = await perpsService.getIntent(originalIntentId);
  if (!original) return c.json({ error: "intent not found" }, 404);
  if (original.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsReplacementSubmitRequest.safeParse({ ...raw, originalIntentId });
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(jsonSafe(await perpsService.createReplacementIntent(parsed.data)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.get("/intents/:id/reconciliation", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const intent = await perpsService.getIntent(c.req.param("id"));
  if (!intent) return c.json({ error: "intent not found" }, 404);
  if (intent.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  const settlementTx = c.req.query("settlementTx")?.toLowerCase();
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }

  try {
    const indexedSettlements = perpsSettlementReader
      ? await perpsSettlementReader.listSettlements({
          chainId: intent.chainId,
          marketId: intent.marketId,
          trader: intent.trader,
          txHash: settlementTx,
          limit,
        })
      : [];
    return c.json(
      jsonSafe({
        indexer: {
          configured: Boolean(perpsSettlementReader),
          settlementTx: settlementTx ?? null,
        },
        reconciliation: reconcilePerpsIntentWithSettlements(intent, indexedSettlements),
      }),
    );
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

perpsRoutes.get("/intents/:id", async (c) => {
  const intent = await perpsService.getIntent(c.req.param("id"));
  if (!intent) return c.json({ error: "intent not found" }, 404);
  return c.json(jsonSafe({ intent }));
});

perpsRoutes.get("/positions/:address", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  const address = c.req.param("address");
  if (!session) return c.json({ error: "wallet session required" }, 401);
  if (address.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "cannot inspect another wallet's private positions" }, 403);
  }
  return c.json({ address, positions: await perpsService.listPositions(address) });
});

perpsRoutes.get("/trades/:address", (c) =>
  c.json({ address: c.req.param("address"), trades: [] }),
);

perpsRoutes.get("/funding", async (c) => {
  const chainId = Number(c.req.query("chainId") ?? 5042002);
  return c.json({ funding: await perpsService.funding(chainId, c.req.query("marketId") ?? undefined) });
});

perpsRoutes.get("/liquidations/candidates", async (c) => {
  const chainId = Number(c.req.query("chainId") ?? 5042002);
  return c.json(jsonSafe({ candidates: await perpsService.liquidationCandidates(chainId) }));
});

export { perpsRoutes };
