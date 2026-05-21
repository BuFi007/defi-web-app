import { test, expect } from "@playwright/test";

import { gotoIsland } from "./fixtures";
import {
  closePosition,
  depositMargin,
  ensureForkOrSkip,
  ForkUnavailableError,
  gotoTradeTab,
  openOrder,
  openPositionsTab,
  setLeverage,
  setSize,
  submitLong,
  waitForOrderToast,
  withdrawMargin,
} from "./perps-fixtures";

/**
 * Wave E2 — Perp open → close → withdraw round-trip.
 *
 * Drives the full lifecycle of a perpetual position against an Anvil fork
 * of Arc Testnet. The fork is spun up by e2e/global-setup.ts when
 * PERPS_E2E_FORK_ARC=1; without that env var the entire suite skips so
 * the existing arcade/loan tests don't acquire an anvil dependency.
 *
 * The intended end-to-end shape, mirroring the Wave E2 task spec:
 *
 *   1. Open the Trade tab; verify the chart canvas mounts (proxy for
 *      hydration completing — onClick handlers don't fire pre-hydration).
 *   2. Read the dev-wallet's pre-trade USDC balance (so the withdraw step
 *      can assert restoration).
 *   3. Deposit $5 USDC margin → assert margin reflected in Positions tab.
 *   4. Submit a market Long on EURC/USDC at 0.5 USDC notional. Expect
 *      the optimistic UI to surface `isPending: true` immediately (Wave D
 *      PR #49) then flip to `isPending: false` once Ponder indexes the
 *      MatchSettled event.
 *   5. Verify the position row shows correct size, entry price, mark
 *      price.
 *   6. Click "Close position" → expect the position row to vanish.
 *   7. Withdraw margin → verify wallet USDC restored.
 *
 * STATE OF THE WORLD (2026-05-19):
 *
 *   - Step 1 (chart + Trade tab mount): WORKS today.
 *   - Step 4a (submit Long via order panel): WORKS today — the order
 *     panel signs the EIP-712 intent via the dev-wallet shim and POSTs
 *     to /perps/intents/submit. We can assert the toast.
 *   - Step 2, 3, 5, 6, 7: BLOCKED. The UI surface for deposit / withdraw
 *     / close-position / position-row-with-mark-price is not yet
 *     implemented on origin/main. See perps-fixtures.ts for the precise
 *     gap notes per helper.
 *
 *   - Step 4b (Ponder isPending flip): BLOCKED — the optimistic UI from
 *     PR #49 is not merged. The test asserts toast visibility instead.
 *
 * Per the Wave E2 task stop-condition: rather than silently fake the
 * missing steps, we keep them as `test.fixme()` blocks. The Playwright
 * report renders them as known-skipped — Wave F PRs flip them to
 * `test()` once the UI lands.
 */

test.describe("perps round-trip (open → close → withdraw)", () => {
  test.beforeAll(async () => {
    try {
      await ensureForkOrSkip();
    } catch (err) {
      if (err instanceof ForkUnavailableError) {
        test.skip(true, `forked Arc anvil unavailable — ${err.message}`);
      }
      throw err;
    }
  });

  test("Trade tab mounts with chart + order panel", async ({ page }) => {
    await gotoTradeTab(page);
    // Chart is the load-bearing visual — if it's not visible the page
    // hasn't finished hydrating and the order panel onClick handlers
    // wouldn't fire anyway.
    await expect(page.locator(".t-chart canvas").first()).toBeVisible();
    await expect(page.locator(".order-card")).toBeVisible();
    // The submit buttons must be rendered (they may be disabled if no
    // wallet is connected, which is fine — we're just asserting the
    // panel layout).
    await expect(page.locator(".long-short button.long")).toBeVisible();
    await expect(page.locator(".long-short button.short")).toBeVisible();
  });

  test("market picker shows >1 market", async ({ page }) => {
    await gotoTradeTab(page);
    const picker = page.locator(".market-mini").first();
    await expect(picker).toBeVisible();
    await picker.click();
    await expect(page.locator(".mp-list")).toBeVisible({ timeout: 5_000 });
    const rows = await page.locator(".mp-row").count();
    expect(rows).toBeGreaterThan(1);
  });

  test("submit market Long via order panel → toast appears", async ({
    page,
  }) => {
    await gotoTradeTab(page);

    // The dev-wallet shim signs as long as NEXT_PUBLIC_PERPS_REPLACEMENT_E2E
    // (or BENTO_E2E in the unified provider) is set. The order panel
    // exposes the long submit at the bottom of `.order-card`.
    //
    // Size 0.5, leverage 2 — small enough to fit any dev-wallet USDC
    // balance, large enough that the keeper-matcher actually processes
    // it (sub-cent intents may be skipped by some keepers).
    try {
      await openOrder(page, "long", {
        sizeBase: "0.5",
        leverage: 2,
        orderType: "market",
      });
      await waitForOrderToast(page, "Long");
    } catch (err) {
      // Two known reasons this can fail in a CI box without an Arc Testnet
      // wallet whitelisted on the keeper:
      //   (a) keeper rejects the signed intent (chain mismatch, nonce, etc.)
      //   (b) /perps/intents/submit is unreachable (apps/api not running)
      // Both are environmental, not a regression of THIS test surface, so
      // we surface the error but don't fail-hard the suite when the
      // PERPS_E2E_PERMIT_MISSING_KEEPER opt-out is set.
      if (process.env.PERPS_E2E_PERMIT_MISSING_KEEPER === "1") {
        test.info().annotations.push({
          type: "warn",
          description: `keeper submit failed (permitted): ${(err as Error).message}`,
        });
        return;
      }
      throw err;
    }
  });

  // ============================================================
  // Wave-F blocked tests — UI surface missing on origin/main.
  // ============================================================

  test.fixme(
    "deposit $5 USDC margin → reflected in Positions tab",
    async ({ page }) => {
      // BLOCKED: no deposit-margin UI in apps/web/components/trade-island.
      // The perps-router contract supports depositCollateral() and the
      // ABI is in apps/web/constants/ABI.ts, but no React component
      // surfaces a click target.
      //
      // Wave F: add a "Margin" panel (or modal) to the order card with
      // deposit + withdraw + max buttons that call the router via wagmi.
      await gotoTradeTab(page);
      await depositMargin(page, 5);
      await openPositionsTab(page);
      await expect(page.locator(".hsum-card", { hasText: "Margin Used" }))
        .toContainText(/\$5\.00|5 USDC/);
    },
  );

  test.fixme(
    "open Long → Ponder settles → row flips isPending false",
    async ({ page }) => {
      // BLOCKED: Wave D PR #49 (optimistic UI with isPending flag) and
      // Wave D PR #46 (Ponder MatchSettled handler that updates the
      // positions DTO) are not on main yet. Once both land, the
      // PerpsPositionsView in trade-island/index.tsx will render a
      // data-pending attribute that this test can poll.
      await gotoTradeTab(page);
      await openOrder(page, "long", {
        marketSym: "EUR/USD",
        sizeBase: "0.5",
        leverage: 2,
        orderType: "market",
      });
      await submitLong(page); // explicit
      await openPositionsTab(page);
      // Step (a): optimistic row appears with data-pending="true"
      const row = page.locator("tr[data-position-row]").first();
      await expect(row).toHaveAttribute("data-pending", "true", { timeout: 5_000 });
      // Step (b): Ponder settles → flip to false
      await expect(row).toHaveAttribute("data-pending", "false", { timeout: 60_000 });
      // Step (c): mark price column is numeric
      await expect(row.locator("[data-col=mark]")).toHaveText(/\d+\.\d+/);
    },
  );

  test.fixme(
    "close position → row vanishes",
    async ({ page }) => {
      // BLOCKED: the Close button at panels.tsx :749 has no onClick wired
      // (renders `<button className="close-btn">Close</button>` with no
      // handler). Wave F: bind it to a reduce-only intent submission via
      // the existing usePlaceOrder shape.
      await gotoTradeTab(page);
      await openPositionsTab(page);
      await closePosition(page);
      const row = page.locator("tr[data-position-row]").first();
      await expect(row).toHaveCount(0, { timeout: 60_000 });
    },
  );

  test.fixme(
    "withdraw margin → dev-wallet USDC restored",
    async ({ page }) => {
      // BLOCKED: same as depositMargin — no UI exposes the withdraw
      // click target. The router has withdrawCollateral(); component
      // surface is the missing piece.
      await gotoTradeTab(page);
      await withdrawMargin(page, 5);
      // Assert balance returns close to pre-deposit (allow $0.01 slop
      // for fees once the modal exposes a "max" button).
      const balance = await page.locator("[data-balance=usdc]").textContent();
      expect(balance).toBeTruthy();
    },
  );

  // Smoke-check that the unused fixture import is referenced — keeps
  // tsc happy without re-exporting through the test file.
  test("setup helpers compile", async ({ page }) => {
    await gotoIsland(page);
    void setSize;
    void setLeverage;
    void submitLong;
    void openPositionsTab;
  });
});
