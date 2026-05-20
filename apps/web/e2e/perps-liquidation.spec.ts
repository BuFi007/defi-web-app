import { test, expect } from "@playwright/test";

import {
  ensureForkOrSkip,
  ForkUnavailableError,
  gotoTradeTab,
} from "./perps-fixtures";
import {
  isAnvilReachable,
  mineBlocks,
  setNextBlockTimestamp,
  getBlockNumber,
} from "./anvil-helpers";

/**
 * Wave E2 — Liquidation flow against forked Arc Testnet.
 *
 * The intended end-to-end shape:
 *
 *   1. Open a high-leverage position (say 20x EURC/USDC long).
 *   2. Use anvil_setStorageAt to push the oracle mock past the
 *      liquidation threshold (OR anvil_setStorageAt on the position's
 *      entryPriceE18 slot — whichever the deployed perps-router exposes
 *      as the test seam).
 *   3. Verify the PositionLiquidationStatus pill flips to "danger".
 *   4. evm_setNextBlockTimestamp past the 60s flag delay.
 *   5. Verify the position becomes liquidatable (canFlag = true on the
 *      router view function).
 *   6. (optional) impersonate a third-party EOA, fire flagAccount() →
 *      verify the rescind CTA renders.
 *   7. (optional) trigger liquidator → AccountLiquidated event → row
 *      disappears + entry in the liquidation feed.
 *
 * STATE OF THE WORLD (2026-05-19):
 *
 *   - The liquidation status pill (PR #50's <PositionLiquidationStatus />)
 *     is NOT merged on main. There is no `[data-liq-status]` element to
 *     query.
 *   - The liquidation feed UI is NOT merged.
 *   - The rescind CTA is NOT merged.
 *   - The router's storage slot for the oracle mock's price has not been
 *     surveyed against the deployed Arc Testnet contracts. Without a
 *     concrete address + slot mapping, anvil_setStorageAt is a stab in
 *     the dark.
 *
 * Whole suite is therefore behind `test.fixme()`. The Wave-F follow-up
 * lands the UI; the contract-storage survey is documented inline so a
 * future contributor doesn't have to re-discover it.
 *
 * The basic anvil cheat-code wiring (setNextBlockTimestamp + mineBlocks)
 * IS exercised below to prove the helpers work — this stays as a real
 * test so the e2e harness itself doesn't regress.
 */

test.describe("perps liquidation flow", () => {
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

  test("anvil cheat-codes reachable (smoke)", async () => {
    // Sanity: prove the anvil-helpers can drive setNextBlockTimestamp +
    // mineBlocks. If this breaks, the liquidation flow can't be
    // bootstrapped — fail loudly here rather than mid-liquidation
    // assertion.
    expect(await isAnvilReachable()).toBe(true);
    const before = await getBlockNumber();
    // Advance one block; advance chain time by 5 minutes. Both are
    // idempotent in a fork — anvil rolls forward cleanly.
    const fiveMinutes = 5 * 60;
    const targetTs = Math.floor(Date.now() / 1000) + fiveMinutes;
    await setNextBlockTimestamp(targetTs);
    await mineBlocks(1);
    const after = await getBlockNumber();
    expect(after).toBeGreaterThan(before);
  });

  test.fixme(
    "open high-leverage Long → push oracle into danger zone → status pill turns red",
    async ({ page }) => {
      // BLOCKED — multiple gaps:
      //
      //   1. PositionLiquidationStatus component (PR #50) not on main.
      //      Without `[data-liq-status]` (or whatever marker it ends up
      //      using) the assertion has no DOM to read.
      //
      //   2. The oracle mock storage slot on the deployed Arc Testnet
      //      perps-router has not been mapped. To unblock this:
      //        a. Forge inspect the deployed router for the oracle
      //           feed registry slot.
      //        b. Compute keccak256(abi.encode(marketId, slot)) for the
      //           EURC/USDC market.
      //        c. Pass that slot to anvil-helpers.setStorageAt with a
      //           value that pushes price below the long's liq price.
      //
      //   3. The deposit-margin step (see perps-open-close.spec.ts) has
      //      no UI, so we can't put a position INTO the danger zone
      //      without first taking the deposit route.
      //
      // When ALL three land, the test body roughly looks like:
      //
      //   await gotoTradeTab(page);
      //   await depositMargin(page, 10);
      //   await openOrder(page, "long", { sizeBase: "1", leverage: 20 });
      //   await setStorageAt(ORACLE_ADDR, ORACLE_SLOT, BAD_PRICE_VALUE);
      //   await mineBlocks(1);
      //   await openPositionsTab(page);
      //   await expect(page.locator("[data-liq-status=danger]")).toBeVisible();
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "after 60s flag delay → position becomes liquidatable",
    async ({ page }) => {
      // BLOCKED on the same gaps as the above + the flagAccount() router
      // ABI. We DO have setNextBlockTimestamp working (smoke test
      // above), so this is the closest-to-ready of the three.
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "third-party flagAccount → rescind CTA renders",
    async ({ page }) => {
      // BLOCKED:
      //   - the rescind CTA component itself isn't merged
      //   - NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED feature flag is
      //     not yet wired
      //   - need anvil_impersonateAccount + a known liquidator address
      //     to fire the flagAccount() call. impersonate is implemented
      //     in anvil-helpers; the missing piece is the addr.
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "liquidator triggers → AccountLiquidated event + position closes",
    async ({ page }) => {
      // BLOCKED on the liquidation feed UI (also part of PR #50). The
      // contract-level liquidate() call we could fire today, but
      // there's no DOM to assert the feed update against.
      await gotoTradeTab(page);
    },
  );
});
