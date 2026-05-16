import { Hono } from "hono";
import { z } from "zod";

import { mockVerifier, paymentRequired } from "@bufi/x402";

import type { WalletSession } from "@bufi/shared-types";

const perpsRoutes = new Hono();

const quoteBody = z.object({
  chainId: z.union([z.literal(43113), z.literal(919), z.literal(5042002)]),
  marketId: z.string().min(1),
  side: z.enum(["long", "short"]),
  sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  leverage: z.number().int().min(1).max(50),
});

const intentBody = quoteBody.extend({
  trader: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deadline: z.number().int(),
  nonce: z.string(),
});

const sellerForX402 = () =>
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

perpsRoutes.get("/markets", (c) => c.json({ markets: [] }));

perpsRoutes.post("/quote", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = quoteBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  // Free quote stub — premium-sim version is /perps/quote/premium and gated.
  return c.json(
    {
      ...parsed.data,
      indicativePrice: "0",
      estimatedFundingBps: 0,
      oracle: { source: null, timestamp: 0, maxStaleSeconds: 30 },
    },
    501,
  );
});

perpsRoutes.use(
  "/quote/premium",
  paymentRequired({
    toolName: "perps.quote.premium",
    priceUsdc: "0.0010",
    sellerAddress: sellerForX402(),
    verifier: mockVerifier,
  }),
);
perpsRoutes.post("/quote/premium", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = quoteBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  return c.json({ ...parsed.data, premium: true, indicativePrice: "0" }, 501);
});

perpsRoutes.post("/intents", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = intentBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  if (parsed.data.trader.toLowerCase() !== session.address.toLowerCase()) {
    return c.json({ error: "trader must match session address" }, 403);
  }
  // TODO: build EIP-712 digest, return for trader to sign.
  return c.json({ intentId: "stub", digest: "0x" }, 501);
});

perpsRoutes.get("/intents/:id", (c) =>
  c.json({ intentId: c.req.param("id"), status: "stub" }, 501),
);

perpsRoutes.get("/positions/:address", (c) =>
  c.json({ address: c.req.param("address"), positions: [] }),
);

perpsRoutes.get("/trades/:address", (c) =>
  c.json({ address: c.req.param("address"), trades: [] }),
);

perpsRoutes.get("/funding", (c) => c.json({ funding: [] }));

perpsRoutes.get("/liquidations/candidates", (c) => c.json({ candidates: [] }));

export { perpsRoutes };
