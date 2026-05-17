import { Hono } from "hono";

import {
  commitRequest,
  createRoomRequest,
  revealRequest,
  settleRequest,
} from "@bufi/fx-bento";
import { paymentRequired } from "@bufi/x402";

import type { WalletSession } from "@bufi/shared-types";

import { bentoService, errorStatus, paymentVerifier, receiptStore } from "../services";

const fxBentoRoutes = new Hono();

const sellerForX402 = () =>
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

const createRoomPayment = paymentRequired({
  toolName: "bufx.bento.room.create",
  priceUsdc: "0.5000",
  sellerAddress: sellerForX402(),
  verifier: paymentVerifier,
  receipts: receiptStore,
});

fxBentoRoutes.post("/rooms", createRoomPayment, async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = createRoomRequest.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await bentoService.createRoom(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.get("/rooms", async (c) =>
  c.json({ rooms: await bentoService.listRooms(c.req.query("status") as never) }),
);

fxBentoRoutes.get("/rooms/:id", async (c) => {
  const room = await bentoService.getRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room not found" }, 404);
  return c.json({ room });
});

fxBentoRoutes.post("/rooms/:id/join", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) return c.json({ error: "wallet session required" }, 401);
  try {
    return c.json(await bentoService.joinRoom({ roomId: c.req.param("id"), player: session.address }));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/commit", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = commitRequest.safeParse({ ...raw, roomId: c.req.param("id") });
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await bentoService.commit(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/reveal", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = revealRequest.safeParse({ ...raw, roomId: c.req.param("id") });
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await bentoService.reveal(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.get("/rooms/:id/leaderboard", async (c) =>
  c.json({ roomId: c.req.param("id"), entries: await bentoService.leaderboard(c.req.param("id")) }),
);

fxBentoRoutes.post("/rooms/:id/settle", async (c) => {
  const parsed = settleRequest.safeParse({ roomId: c.req.param("id") });
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json(await bentoService.settle(parsed.data));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

export { fxBentoRoutes };
