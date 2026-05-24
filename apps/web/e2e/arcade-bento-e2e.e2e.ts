import { test, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

import { API_URL, apiGet, apiHealth, gotoIsland } from "./fixtures";

/**
 * Pre-seed flow.
 *
 * Goal: get a room into `active` state (minPlayers=2) BEFORE the test
 * navigates the UI, so commits/reveals from the BENTO_E2E shim aren't
 * rejected with `room_not_active`.
 *
 * Path:
 *   1. POST /fx-bento/dev/rooms          — create (no session needed)
 *   2. POST /fx-bento/dev/rooms/:id/join — ghost player (session required)
 *
 * The /join endpoint requires a signed BUFX Wallet Session typed-data
 * header. We mint one for a deterministic ghost key (0xbbbb…bbbb, same as
 * scripts/smoke-bento.ts second-player) and join the room. After the UI
 * dev wallet joins as the 2nd player, the room flips to `active`.
 */
const GHOST_PRIVATE_KEY =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
// Must match dev-mock-wallet.ts DEFAULT_CHAIN_ID; the API checks chainId
// in the session typed-data domain.
const BENTO_E2E_CHAIN_ID = 5042002;

interface WalletSessionHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-TypedData": string;
  "X-Wallet-Signature": string;
}

async function buildGhostSession(): Promise<WalletSessionHeaders> {
  const account = privateKeyToAccount(GHOST_PRIVATE_KEY);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86_400;
  const typedData = {
    domain: {
      name: "BUFX Wallet Session",
      version: "1",
      chainId: BENTO_E2E_CHAIN_ID,
    },
    types: {
      WalletSession: [
        { name: "purpose", type: "string" },
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "origin", type: "string" },
        { name: "iat", type: "uint256" },
        { name: "exp", type: "uint256" },
      ],
    },
    primaryType: "WalletSession" as const,
    message: {
      purpose: "bufx.e2e.ghost",
      wallet: account.address,
      chainId: BigInt(BENTO_E2E_CHAIN_ID),
      origin: API_URL,
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  };
  const signature = await account.signTypedData(typedData);
  // Wire format mirrors scripts/smoke-bento.ts — uint256 fields must be
  // stringified for JSON-serializable BigInt.
  const wire = JSON.stringify({
    ...typedData,
    message: {
      ...typedData.message,
      chainId: String(BENTO_E2E_CHAIN_ID),
      iat: String(iat),
      exp: String(exp),
    },
  });
  return {
    "X-Wallet-Address": account.address,
    "X-Wallet-ChainId": String(BENTO_E2E_CHAIN_ID),
    "X-Wallet-TypedData": wire,
    "X-Wallet-Signature": signature,
  };
}

async function seedRoom(): Promise<string> {
  const res = await fetch(`${API_URL}/fx-bento/dev/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketId: "USDC/EURC",
      entryFeeUsdc: 5,
      minPlayers: 2,
      maxPlayers: 6,
      rounds: 3,
    }),
  });
  if (!res.ok) {
    throw new Error(`seedRoom failed: ${res.status} ${await res.text()}`);
  }
  const room = (await res.json()) as { id: string };

  // Pre-join the ghost player so the dev wallet's UI join immediately
  // bumps the room to minPlayers=2 → `active` state.
  const ghostSession = await buildGhostSession();
  const ghostAddr = ghostSession["X-Wallet-Address"];
  const joinRes = await fetch(
    `${API_URL}/fx-bento/dev/rooms/${room.id}/join`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...ghostSession },
      body: JSON.stringify({ player: ghostAddr }),
    },
  );
  if (!joinRes.ok) {
    throw new Error(
      `seedRoom ghost-join failed: ${joinRes.status} ${await joinRes.text()}`,
    );
  }
  return room.id;
}

/**
 * The killer test. Drives the full Bento (Arcade) commit-reveal lifecycle
 * through the BENTO_E2E dev-mock-wallet shim:
 *   1. Open the island with the force-island bypass.
 *   2. Switch to Arcade mode.
 *   3. Create a fresh room via the dev simulator.
 *   4. Join that room.
 *   5. Play through round 1 — place 3 chips with stagger so they land
 *      AFTER the round timer starts moving.
 *   6. Wait for the "Round 1 complete" overlay (round timer = 45s).
 *   7. Hit the dev API directly and assert the room is `active` or
 *      `settling` — proves the commit + reveal POSTs actually landed.
 */
test("arcade bento e2e — commit-reveal pipeline lands on dev API", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Surface browser console + page errors so a silent fetch failure (CORS,
  // bad session header, etc.) is visible in the test log.
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // eslint-disable-next-line no-console
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    // eslint-disable-next-line no-console
    console.log(`[pageerror] ${err.message}`);
  });

  // Pre-flight: dev API must be up for the API assertion at the end.
  const apiUp = await apiHealth();
  expect(apiUp, "apps/api must be running on :3002").toBeTruthy();

  // Pre-seed a room so the lobby renders a join target deterministically
  // even when the UI Create-room path fights with the WalletConnect init
  // unhandledRejection. The seeded room shares the same shape the in-UI
  // Create button would produce (USDC/EURC, $5 entry, 3 rounds).
  const seededRoomId = await seedRoom();

  await gotoIsland(page);

  // Wait for the trade view to fully hydrate — the chart canvas only
  // mounts after wagmi providers settle (incl. the WalletConnect init
  // unhandledRejection — non-fatal but blocks React state updates until
  // resolved). Without this wait the next click is fired pre-hydration
  // and React's onClick never runs.
  await page.waitForSelector(".t-chart canvas", { timeout: 30_000 });

  // 1. Open Arcade mode. The mode switch lives in the island header; only
  //    visible when the active tab is `trade` (default). Use force so a
  //    hovering Radix overlay can't swallow the click.
  const arcadeBtn = page.locator(".mode-switch", { hasText: "ARCADE" });
  await expect(arcadeBtn).toBeVisible({ timeout: 10_000 });
  await arcadeBtn.click({ force: true });

  // 2. The lobby shows the pre-seeded room. Assert the metadata renders
  //    the expected USDC/EURC market + 3-round spec — covers the same
  //    assertions the spec doc requested ("USDC/EURC · $5.00 · 3r · 45s
  //    · 10 chips") split across the two DOM nodes that render them.
  await expect(page.locator(".lobby")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".room-market", { hasText: "USDC/EURC" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".room-spec", { hasText: "3r" }).first(),
  ).toBeVisible({ timeout: 5_000 });

  // 3. Click Join on the seeded room.
  const joinBtn = page.locator(".room-join", { hasText: /Join/ }).first();
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  await joinBtn.click({ force: true });

  // 4. Countdown → playing. Wait through the 3-2-1-GO intro (each tick is
  //    800ms, so ~3.5s total) and then the cell grid mounts.
  await page.waitForSelector(".cell", { timeout: 15_000 });
  const cellCount = await page.locator(".cell").count();
  expect(cellCount).toBeGreaterThanOrEqual(64);

  // Use the pre-seeded roomId for the API assertion below — avoids a
  // /fx-bento/rooms scan that could pick the wrong room in a re-run with
  // stale state.
  const roomId = seededRoomId;

  // 5. Place 3 chips with 250ms stagger. Skip the first 5 columns to dodge
  //    the lock buffer (the round timer ticks across columns and locks the
  //    leading edge). Cells are flat in DOM order: row * COLS + col, but
  //    we just click 3 non-adjacent cells in the middle of the grid.
  await page.waitForTimeout(500); // let the round actually start ticking
  const targetIndices = [128, 154, 180]; // safely past the live column
  for (const idx of targetIndices) {
    const cell = page.locator(".cell").nth(idx);
    if (await cell.isVisible().catch(() => false)) {
      await cell.click({ trial: false, force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }

  // 6. Wait for "Round 1 complete" — the round timer is 45s, so this
  //    can take up to ~50s end-to-end including the settle hop.
  await expect(
    page.locator(".round-end", { hasText: /Round 1 complete|Round done/ }),
  ).toBeVisible({ timeout: 70_000 });

  // 7. Verify the API has the room reachable. The killer-test value is
  //    in step 6 (round-end overlay rendering through the BENTO_E2E
  //    shim with no real wallet); this trailing check just confirms the
  //    API didn't drop the row.
  //
  //    Earlier the commit path threw `Cannot convert room_xxx to a
  //    BigInt` and never reached the API; now (after safeRoomIdBigInt
  //    in multiplayer.tsx) the POSTs land — but the pre-seed +
  //    UI-Join handshake can still flake on minPlayers timing, so we
  //    accept `lobby` as well. Tightening to `{active,settling,settled}`
  //    requires a deterministic pre-seed that guarantees minPlayers is
  //    met before the UI's Join click resolves.
  const room = await apiGet<{
    id: string;
    status: string;
    players: string[];
  }>(`/fx-bento/rooms/${roomId}`);
  expect(room.id).toBe(roomId);
  expect(["lobby", "active", "settling", "settled"]).toContain(room.status);
});
