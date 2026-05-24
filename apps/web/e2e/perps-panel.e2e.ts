import { test, expect } from "@playwright/test";

import { gotoIsland } from "./fixtures";

/**
 * Perps panel smoke. Verifies:
 *   - The default Trade tab renders the chart canvas (lightweight-charts).
 *   - Timeframe selector swaps without crashing the canvas.
 *   - Order type Limit reveals the TP/SL collapse trigger.
 *   - The market picker opens a popover with >1 market.
 *
 * Trade is the default tab so no explicit click is required.
 */
test("perps panel — chart, timeframe, order type, market picker", async ({
  page,
}) => {
  await gotoIsland(page);

  // The trade-tab layout pins the chart card under `.t-chart`. The chart
  // mounts a canvas via lightweight-charts (multiple canvases — the
  // library uses one per pane). Wait for AT LEAST one.
  const chartCanvas = page.locator(".t-chart canvas").first();
  await expect(chartCanvas).toBeVisible({ timeout: 15_000 });

  // Snapshot the initial canvas bounding box so we can confirm dimensions
  // stay positive across the timeframe swap.
  const initialBox = await chartCanvas.boundingBox();
  expect(initialBox?.width ?? 0).toBeGreaterThan(0);
  expect(initialBox?.height ?? 0).toBeGreaterThan(0);

  // Click the 1H timeframe. The button is `.tf-btn` inside
  // `.timeframe-tabs` (see panels.tsx).
  const tf1H = page.locator(".tf-btn", { hasText: /^1H$/ });
  await expect(tf1H).toBeVisible();
  await tf1H.click();
  await page.waitForTimeout(500); // let the chart re-render

  const afterBox = await chartCanvas.boundingBox();
  expect(afterBox?.width ?? 0).toBeGreaterThan(0);
  expect(afterBox?.height ?? 0).toBeGreaterThan(0);

  // Order type Limit. Open the order panel button via class — the order
  // panel has class `order-type-tabs` with one button per type. The
  // button text is "Limit" (case-sensitive in the markup).
  const limitBtn = page.locator(".order-type-tabs button", {
    hasText: /^Limit$/,
  });
  await expect(limitBtn).toBeVisible({ timeout: 10_000 });
  await limitBtn.click();

  // After picking Limit, the TP/SL collapse trigger button is rendered
  // (it actually renders for ALL order types, but only Limit reveals the
  // accompanying Price field). Click the trigger to open the TP/SL pane
  // and confirm "Take Profit" + "Stop Loss" labels show.
  const tpSlTrigger = page.locator("button", {
    hasText: "Take Profit / Stop Loss",
  });
  await expect(tpSlTrigger).toBeVisible();
  await tpSlTrigger.click();
  await expect(page.locator(".tp-sl .field.tp")).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    page.locator(".tp-sl .field.tp .field-label", { hasText: "Take Profit" }),
  ).toBeVisible();
  await expect(
    page.locator(".tp-sl .field.sl .field-label", { hasText: "Stop Loss" }),
  ).toBeVisible();

  // Market picker — the trigger is `.market-mini`. Clicking opens a
  // Radix popover that mounts `.mp-list` with one `.mp-row` per market.
  const picker = page.locator(".market-mini").first();
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(page.locator(".mp-list")).toBeVisible({ timeout: 5_000 });
  const marketRowCount = await page.locator(".mp-row").count();
  expect(marketRowCount).toBeGreaterThan(1);
});
