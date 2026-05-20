import { test, expect } from "@playwright/test";

import {
  ensureForkOrSkip,
  forceLiquidatable,
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
 * Liquidation e2e — staged un-fixme strategy (Wave F5c)
 *
 * The F5c task spec proposed un-fixme-ing the flag-delay-countdown test on
 * the strength of F5b shipping `widenOracleAgeLimit` + `disableRedstone`.
 * On audit against this base branch (`feat/wk1f-anvil-oracle-cheats`) none
 * of the four liquidation tests can be un-fixmed yet:
 *
 *   - pill-turns-danger:    needs price drop  → blocked on F5d setPythPrice
 *                           AND on Wave B / PR #50 PositionLiquidationStatus
 *                           UI (no `[data-liq-status]` element exists on
 *                           this base).
 *   - flag-delay-countdown: needs only time-warp cheats (those WORK today,
 *                           see the smoke test below) — BUT the flag-delay
 *                           countdown UI itself is part of Wave B / PR #50
 *                           and is NOT on this base. No DOM to assert
 *                           against → test stays fixmed, task spec's
 *                           un-fixme step deferred. F5c stop-condition #3
 *                           ("don't un-fixme a test that won't actually
 *                           pass") applies.
 *   - rescind CTA:          needs price recovery → blocked on F5d.
 *   - liquidator-event:     needs price-driven liquidatable state → blocked
 *                           on F5d.
 *
 * What F5c DID deliver to this file:
 *
 *   - `forceLiquidatable` fixture import surfaces the F5b oracle cheats
 *     under a single best-effort wrapper, so when PR #50 lands the
 *     un-fixme follows from a single rg-replaceable line.
 *   - This top-of-file block (and the per-test TODOs) document the F5d
 *     dependency chain so the next contributor doesn't have to re-discover
 *     the gap.
 *
 * F5b shipped `widenOracleAgeLimit` + `disableRedstone` but neither can
 * drive a position's health factor the way these three tests require. See
 * `anvil-helpers/oracle-cheats.README.md` and the F5d task on the
 * production roadmap.
 */

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
      // TODO: F5d — needs setPythPrice. F5c's forceLiquidatable can
      // normalise the oracle freshness gate but cannot push HF into
      // danger. See perps-fixtures.ts `forceLiquidatable` JSDoc.
      //
      // BLOCKED — multiple gaps:
      //
      //   1. PositionLiquidationStatus component (PR #50) not on main.
      //      Without `[data-liq-status]` (or whatever marker it ends up
      //      using) the assertion has no DOM to read.
      //
      //   2. F5d setPythPrice cheat: F5b shipped widenOracleAgeLimit +
      //      disableRedstone (both wired into `forceLiquidatable`) but
      //      driving the trader's HF across the liquidation threshold
      //      requires writing a synthetic Pyth price into the
      //      `PythUpgradable` proxy. That needs a Pyth-specific storage
      //      survey (deferred — see oracle-cheats.ts
      //      SET_PYTH_PRICE_DEFERRED).
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
      //   await forceLiquidatable({ marketId: EURC_USDC_MARKET_ID, trader });
      //   await setPythPrice({ baseToken: EURC, newPriceE18: BAD_PRICE });
      //   await mineBlocks(1);
      //   await openPositionsTab(page);
      //   await expect(page.locator("[data-liq-status=danger]")).toBeVisible();
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "after 60s flag delay → position becomes liquidatable",
    async ({ page }) => {
      // TODO: F5c task spec proposed un-fixme-ing this on the strength of
      // F5b's time-warp cheats — but the flag-delay countdown UI itself
      // ships with Wave B / PR #50 and is NOT on this base. There is no
      // DOM element to assert against. Stay fixmed until PR #50 lands.
      //
      // Once PR #50 is on main, the test body is roughly:
      //
      //   await gotoTradeTab(page);
      //   await forceLiquidatable({ marketId, trader });
      //   // …flag the account on chain via impersonateAccount + tx…
      //   const t0 = (await getBlockNumber()) /* convert to ts */;
      //   await setNextBlockTimestamp(t0 + 61);
      //   await mineBlocks(1);
      //   await openPositionsTab(page);
      //   await expect(page.locator("[data-flag-delay=elapsed]")).toBeVisible();
      //
      // Driving the on-chain flag step itself ALSO needs F5d's
      // setPythPrice to put the position into a flaggable state first.
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "third-party flagAccount → rescind CTA renders",
    async ({ page }) => {
      // TODO: F5d — needs setPythPrice to drive price *recovery* after the
      // position is flagged, which is what surfaces the rescind CTA.
      //
      // BLOCKED:
      //   - the rescind CTA component itself isn't merged (PR #50)
      //   - NEXT_PUBLIC_LIQUIDATION_RESCIND_ENABLED feature flag is
      //     not yet wired
      //   - need anvil_impersonateAccount + a known liquidator address
      //     to fire the flagAccount() call. impersonate is implemented
      //     in anvil-helpers; the missing piece is the addr.
      //   - need F5d setPythPrice to push the price back up post-flag
      //     so the rescind option even surfaces in the UI.
      await gotoTradeTab(page);
    },
  );

  test.fixme(
    "liquidator triggers → AccountLiquidated event + position closes",
    async ({ page }) => {
      // TODO: F5d — needs setPythPrice to put the position into a
      // price-driven liquidatable state. forceLiquidatable only
      // normalises the oracle freshness gate; it can't move HF.
      //
      // BLOCKED on the liquidation feed UI (also part of PR #50). The
      // contract-level liquidate() call we could fire today, but
      // there's no DOM to assert the feed update against, and we still
      // need F5d to put the position into a liquidatable state first.
      await gotoTradeTab(page);
    },
  );
});
