/// <reference types="bun-types" />
/**
 * Integration tests for the fx-bento Hono router (Bucket #28).
 *
 * These exercise the in-memory simulator (the `/dev/*` surface) without
 * spinning up a full server. Each test wraps the router in a tiny parent
 * app so the `c.var.log` middleware and an optional walletSession can be
 * mounted — mirroring what `apps/api/src/server.ts` does in prod.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { WalletSession } from "@bufi/shared-types";

import { fxBentoRoutes } from "./fx-bento";

// Ensure the dev simulator is enabled — routes call `assertDevSimulatorEnabled`.
beforeAll(() => {
  process.env.NODE_ENV ??= "test";
});

interface HarnessOptions {
  session?: WalletSession | null;
}

function harness({ session = null }: HarnessOptions = {}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("log", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => c.var.log,
    } as unknown as never);
    c.set("walletSession", session);
    await next();
  });
  app.route("/", fxBentoRoutes);
  return app;
}

const PLAYER_ADDRESS = "0x000000000000000000000000000000000000B0B0";

afterEach(() => {
  // Best-effort: each test creates a unique room id, so we don't bother
  // resetting the singleton in-memory `rooms` map between cases.
});

describe("fx-bento routes", () => {
  test("GET /rooms returns the simulator's room list", async () => {
    const app = harness();
    const res = await app.request("/rooms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: unknown[] };
    expect(Array.isArray(body.rooms)).toBe(true);
  });

  test("POST /dev/rooms with bad market id returns 500 + 'Unsupported market'", async () => {
    const app = harness();
    const res = await app.request("/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "FOO/BAR" }),
    });
    // Schema regex requires UPPERCASE pair shape; FOO/BAR passes regex but
    // `requireMarket()` rejects it as an unsupported pair.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Unsupported market");
  });

  test("POST /dev/rooms with USDC/EURC returns 201 + room object", async () => {
    const app = harness();
    const res = await app.request("/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketId: "USDC/EURC",
        entryFeeUsdc: 5,
        minPlayers: 2,
        maxPlayers: 4,
        rounds: 3,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; marketId: string };
    expect(body.id).toMatch(/^room_/);
    expect(body.status).toBe("lobby");
    expect(body.marketId).toBe("USDC/EURC");
  });

  test("POST /dev/rooms/:id/join without a wallet session returns 401", async () => {
    // First create a room so the join endpoint has a valid target.
    const seedApp = harness();
    const seedRes = await seedApp.request("/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "USDC/EURC" }),
    });
    const seed = (await seedRes.json()) as { id: string };

    const app = harness({ session: null });
    const res = await app.request(`/dev/rooms/${seed.id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: PLAYER_ADDRESS }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("wallet session");
  });

  test("POST /dev/rooms/:id/join with a session adds the player", async () => {
    const seedApp = harness();
    const seedRes = await seedApp.request("/dev/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: "USDC/EURC" }),
    });
    const seed = (await seedRes.json()) as { id: string };

    const session: WalletSession = {
      address: PLAYER_ADDRESS as `0x${string}`,
      chainId: 43113,
      proof: {
        message: "dev",
        signature: "0x00" as `0x${string}`,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    };
    const app = harness({ session });
    const res = await app.request(`/dev/rooms/${seed.id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: PLAYER_ADDRESS }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string; player: string };
    expect(body.roomId).toBe(seed.id);
    expect(body.player.toLowerCase()).toBe(PLAYER_ADDRESS.toLowerCase());
  });

  test("GET /rooms/:id returns 404 for an unknown room", async () => {
    const app = harness();
    const res = await app.request("/rooms/room_unknown");
    expect(res.status).toBe(404);
  });

  test("GET /rooms/:id/claims/:address returns the no-proof claim shape when no settlement exists", async () => {
    const app = harness();
    const res = await app.request(
      `/rooms/room_unknown/claims/${PLAYER_ADDRESS}?chainId=43113`,
    );
    // No settlement-result is registered; the route degrades to the
    // "simulator" source with an empty proof rather than 500ing.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roomId: string;
      address: string;
      claimable: boolean;
      amount: string;
      proof: unknown[];
      source: string;
    };
    expect(body.roomId).toBe("room_unknown");
    expect(body.address).toBe(PLAYER_ADDRESS.toLowerCase());
    expect(body.claimable).toBe(false);
    expect(body.amount).toBe("0");
    expect(Array.isArray(body.proof)).toBe(true);
    expect(body.source).toBe("simulator");
  });
});
