import { Hono } from "hono";
import { z } from "zod";

import { mockVerifier, paymentRequired } from "@bufi/x402";

import type { WalletSession } from "@bufi/shared-types";

const fxBentoRoutes = new Hono();

const createRoomBody = z.object({
  chainId: z.union([z.literal(43113), z.literal(919), z.literal(5042002)]),
  marketId: z.string().min(1),
  entryFeeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  chipsPerPlayer: z.number().int().min(1).max(10_000),
  maxPlayers: z.number().int().min(2).max(64),
  startsAt: z.number().int(),
  endsAt: z.number().int(),
});

const commitBody = z.object({
  player: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  commitment: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tileId: z.string(),
  chips: z.number().int().min(1),
});

const revealBody = commitBody.extend({
  salt: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const sellerForX402 = () =>
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

// Room creation costs USDC because the protocol provisions liquidity rails for it.
fxBentoRoutes.use(
  "/rooms",
  paymentRequired({
    toolName: "fxBento.createRoom",
    priceUsdc: "0.5000",
    sellerAddress: sellerForX402(),
    verifier: mockVerifier,
  }),
);

fxBentoRoutes.post("/rooms", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = createRoomBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  // TODO: emit RoomCreated onchain via signed intent / runtime signer
  return c.json({ roomId: "stub" }, 501);
});

fxBentoRoutes.get("/rooms", (c) => c.json({ rooms: [] }));

fxBentoRoutes.get("/rooms/:id", (c) =>
  c.json({ roomId: c.req.param("id"), status: "stub" }, 501),
);

fxBentoRoutes.post("/rooms/:id/join", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  return c.json({ roomId: c.req.param("id"), digest: "0x", note: "client signs entry fee" }, 501);
});

fxBentoRoutes.post("/rooms/:id/commit", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = commitBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  return c.json({ ok: true, commitment: parsed.data.commitment }, 501);
});

fxBentoRoutes.post("/rooms/:id/reveal", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = revealBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  // TODO: verify commitment == keccak256(abi.encode(salt, tileId, chips))
  return c.json({ ok: true }, 501);
});

fxBentoRoutes.get("/rooms/:id/leaderboard", (c) =>
  c.json({ roomId: c.req.param("id"), entries: [] }),
);

fxBentoRoutes.post("/rooms/:id/settle", async (c) =>
  c.json({ roomId: c.req.param("id"), settled: false, winners: [] }, 501),
);

export { fxBentoRoutes };
