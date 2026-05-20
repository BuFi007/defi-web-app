import { type Page, expect } from "@playwright/test";
import type { Address } from "viem";

import { gotoIsland } from "./fixtures";
import {
  getAnvilRpcUrl,
  isAnvilReachable,
  getChainId,
  mineBlocks,
} from "./anvil-helpers";
import {
  disableRedstone,
  widenOracleAgeLimit,
} from "./anvil-helpers/oracle-cheats";

/**
 * Wave E2 — Perp-specific UI driver helpers.
 *
 * Composes on top of fixtures.ts (alpha cookie + force-island gotoIsland)
 * with the order panel selectors specific to the Trade tab. Pulled into a
 * separate file so the existing arcade/loan/perps-panel tests don't drag
 * in the anvil-helpers dependency.
 *
 * SHIM NOTE: as of 2026-05-19 the UI does NOT yet expose a margin
 * deposit / withdraw / close-position click target — the on-chain
 * deposit+withdraw flow is queued for Wave F. The helpers in this file
 * therefore split into two groups:
 *
 *   - LIVE: gotoTradeTab, openOrderTypeMarket, setSize, submitLong/Short,
 *     waitForToast, openPositionsTab — these drive the order submission
 *     flow that exists today in components/trade-island/panels.tsx.
 *
 *   - PENDING: depositMargin, withdrawMargin, closePosition — these are
 *     surfaced as named stubs that THROW with a clear message pointing at
 *     the missing component. Test files use them via test.fixme() so the
 *     gap is visible in the Playwright report.
 *
 * Don't paper over the gap by silently no-op'ing — if the test pretends
 * to deposit margin when no on-chain tx happens, the round-trip is a
 * lie and the keeper-matcher integration goes unverified.
 */

export interface PerpsOpenOrderOptions {
  /** Market symbol as rendered in `.market-mini` (e.g. "EUR/USD"). */
  marketSym?: string;
  /** Notional size in base units. The order panel input is text. */
  sizeBase: string;
  /** Leverage. 1 = spot (Buy/Sell), >1 = perps (Long/Short). */
  leverage?: number;
  /** "market" or "limit". Default "market". Limit orders also need price. */
  orderType?: "market" | "limit";
  /** Limit price (string). Ignored for market orders. */
  limitPrice?: string;
}

/**
 * Navigate to the Trade tab and wait for the chart canvas + order panel
 * to be visible. Trade is the default tab so no click is needed when
 * `force-island=1` is the only query param, but we accept an explicit
 * `?tab=trade` for the perp suite to be future-proof against the default
 * tab moving.
 */
export async function gotoTradeTab(page: Page): Promise<void> {
  await gotoIsland(page, { search: "?force-island=1" });
  // Wait for the chart canvas — see perps-panel.spec.ts for the rationale
  // (wagmi/WalletConnect init throws unhandledRejection that blocks
  // onClick handlers until hydration completes).
  await expect(page.locator(".t-chart canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  // The order panel is the right column on Trade. Its container has the
  // class `.order-card` (see panels.tsx :304). If this isn't visible we
  // can't drive any submit flow — fail fast with a clear locator.
  await expect(page.locator(".order-card").first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Switch the order type tab. Available values: market / limit / stop /
 * tp/sl. The tabs are buttons under `.order-type-tabs` with the type
 * label as text (case-sensitive — see panels.tsx `types = ["Market",
 * "Limit", "Stop", "TP/SL"]`).
 */
export async function setOrderType(
  page: Page,
  type: "Market" | "Limit" | "Stop" | "TP/SL",
): Promise<void> {
  const btn = page.locator(".order-type-tabs button", {
    hasText: new RegExp(`^${escapeRegex(type)}$`),
  });
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
}

/**
 * Drive the leverage slider via the +/- buttons rather than slider drag
 * (Radix slider doesn't expose a deterministic playwright drag target).
 * Caps at the market's max leverage even if the caller asks for more —
 * the panel itself clamps via `Math.min(market.leverage, lev + 1)`.
 */
export async function setLeverage(page: Page, target: number): Promise<void> {
  // The leverage value pill is `.lev-value`. We read it, then click +/-
  // to converge. Anvil-style polling: at most 100 clicks (the highest
  // documented market max is currently 100x for FX, so this is a safe
  // ceiling).
  const valueLocator = page.locator(".lev-value");
  for (let i = 0; i < 120; i++) {
    const text = (await valueLocator.textContent())?.trim() ?? "";
    const current =
      text === "Spot" ? 1 : Number(text.replace(/[^0-9]/g, "")) || 1;
    if (current === target) return;
    const btn = page.locator(
      `.lev-control button:has(svg)${current < target ? ":last-of-type" : ":first-of-type"}`,
    );
    await btn.click();
  }
  throw new Error(`could not set leverage to ${target}`);
}

/**
 * Fill the size input. Selector is the first `.field` input under
 * `.order-card .order-body` — the only text input rendered with
 * placeholder "0.00" when the order type is "market" (limit also reveals
 * a Price field; setLimitPrice() targets that separately).
 */
export async function setSize(page: Page, sizeBase: string): Promise<void> {
  // We disambiguate by data-* would be cleaner, but the production
  // panel hasn't added them yet. Anchor on the Size label instead:
  // walk up from the "Size" text node to the sibling input wrap.
  const sizeField = page.locator(".field", { hasText: "Size" }).first();
  const input = sizeField.locator("input");
  await input.fill(sizeBase);
}

export async function setLimitPrice(
  page: Page,
  price: string,
): Promise<void> {
  const priceField = page.locator(".field", { hasText: "Price" }).first();
  const input = priceField.locator("input");
  await input.fill(price);
}

/**
 * Click the long (or buy in spot mode) button at the bottom of the
 * order panel. Asserts the button is not in the disabled state first —
 * a silently-disabled submit would leave the test "passing" with no
 * intent actually sent.
 */
export async function submitLong(page: Page): Promise<void> {
  const btn = page.locator(".long-short button.long");
  await expect(btn).toBeEnabled({ timeout: 10_000 });
  await btn.click();
}

export async function submitShort(page: Page): Promise<void> {
  const btn = page.locator(".long-short button.short");
  await expect(btn).toBeEnabled({ timeout: 10_000 });
  await btn.click();
}

/**
 * High-level "open a position" composite. Drives the full order panel
 * end-to-end: leverage → size → submit. Returns nothing — callers chain
 * with waitForOrderToast() to assert the keeper accepted the intent.
 */
export async function openOrder(
  page: Page,
  side: "long" | "short",
  opts: PerpsOpenOrderOptions,
): Promise<void> {
  const orderType = opts.orderType ?? "market";
  await setOrderType(
    page,
    orderType === "market" ? "Market" : "Limit",
  );
  if (opts.leverage != null) {
    await setLeverage(page, opts.leverage);
  }
  if (orderType === "limit" && opts.limitPrice) {
    await setLimitPrice(page, opts.limitPrice);
  }
  await setSize(page, opts.sizeBase);
  if (side === "long") {
    await submitLong(page);
  } else {
    await submitShort(page);
  }
}

/**
 * Wait for the order-submitted toast. Asserts the toast text contains
 * the expected verb — "Long submitted" / "Short submitted" / "Buy
 * submitted" / "Sell submitted" — and either the `intent <digest>` tail
 * (success) or a destructive variant (which the caller should treat as
 * a failure).
 */
export async function waitForOrderToast(
  page: Page,
  expectedVerb: "Long" | "Short" | "Buy" | "Sell",
): Promise<void> {
  // Toast renders via the shared <Toaster /> with role=status. We assert
  // visibility + content within a tight window — if the keeper API is
  // unreachable the toast switches to the destructive "Order failed"
  // variant and the test should surface that as a failure.
  const toast = page.getByText(`${expectedVerb} submitted`, { exact: false });
  await expect(toast).toBeVisible({ timeout: 15_000 });
}

/**
 * Click into the Positions tab on the trade island.
 */
export async function openPositionsTab(page: Page): Promise<void> {
  const positionsTab = page.locator(".island-tabs .island-tab", {
    hasText: "Positions",
  });
  await positionsTab.click({ force: true });
  await expect(page.locator(".pp-view, .positions-only-tab").first()).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Wave F follow-up — UI gap markers.
 *
 * These stubs are referenced by perps-open-close.spec.ts via test.fixme()
 * blocks. The intent is to make the missing UI surface a first-class
 * Playwright artifact (visible in the report as a known-skipped path)
 * instead of a comment that gets lost.
 *
 * When the Wave F PRs land:
 *   - deposit margin UI:      apps/web/components/trade-island/* — add a
 *                             button + modal that calls perps-router
 *                             depositCollateral(collateral, amount).
 *   - close position button:  panels.tsx :749 already renders `.close-btn`
 *                             but has no onClick. Wire it to a new
 *                             useClosePosition() hook backed by
 *                             /perps/intents/submit with reduceOnly=true.
 *   - withdraw margin:        same modal as deposit, different action.
 *
 * Once those land, replace the throw with the actual click flow and
 * the fixme() in the spec with a real test().
 */
export async function depositMargin(_page: Page, _usdAmount: number): Promise<void> {
  throw new Error(
    "depositMargin: UI not implemented yet. " +
      "Trade Tab order panel does not expose a deposit-margin click target as of 2026-05-19. " +
      "Wave F — add a button + modal in components/trade-island/panels.tsx that calls " +
      "the perps-router depositCollateral(). See e2e/perps-open-close.spec.ts test.fixme block.",
  );
}

export async function withdrawMargin(_page: Page, _usdAmount: number): Promise<void> {
  throw new Error(
    "withdrawMargin: UI not implemented yet. " +
      "No withdraw-margin click target exists in the trade island today. " +
      "Wave F — add to the same modal as depositMargin.",
  );
}

export async function closePosition(
  _page: Page,
  _opts?: { marketSym?: string },
): Promise<void> {
  throw new Error(
    "closePosition: UI button has no handler. " +
      "components/trade-island/index.tsx renders <button className='close-btn'>Close</button> " +
      "and <button className='pos-card-close'>Close position</button> but neither is wired " +
      "to a useClosePosition hook. Wave F — bind the click to a reduce-only intent " +
      "submission via the existing usePlaceOrder() shape.",
  );
}

/**
 * Asserts the suite is connected to a fork of Arc Testnet. Used in
 * beforeAll to skip the whole suite if PERPS_E2E_FORK_ARC=0 (anvil not
 * spun up) — without this check the tests fail mid-step on a
 * confusing "fetch http://127.0.0.1:8546 ECONNREFUSED".
 */
export async function ensureForkOrSkip(): Promise<void> {
  if (process.env.PERPS_E2E_FORK_ARC !== "1") {
    // Mark the runner: throwing here in a test.beforeAll lets the caller
    // catch and convert to test.skip().
    throw new ForkUnavailableError("PERPS_E2E_FORK_ARC=1 not set");
  }
  if (!(await isAnvilReachable())) {
    throw new ForkUnavailableError(
      "anvil not reachable at $PERPS_E2E_RPC_URL — global-setup probably failed",
    );
  }
  const chainId = await getChainId();
  // Arc Testnet is 5042002. We allow override (e.g. running against a
  // private fork of mainnet for adversarial review) but warn in stderr.
  if (chainId !== 5042002) {
    // eslint-disable-next-line no-console
    console.warn(
      `[perps-fixtures] connected chain ${chainId} != Arc Testnet (5042002). ` +
        "Override is allowed but tests assume the Arc contract addresses.",
    );
  }
}

export class ForkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkUnavailableError";
  }
}

/**
 * Wave F5c — `forceLiquidatable` cheat orchestrator.
 *
 * Wraps the F5b oracle cheats (`widenOracleAgeLimit` + `disableRedstone`) into
 * a single best-effort call usable from a liquidation e2e test. The shape
 * matches the F5c task spec's `test.extend(...)` proposal as a flat helper —
 * the existing `perps-fixtures.ts` doesn't carry a Playwright-fixture context
 * (no `test.extend` skeleton from PR #54), so a flat function is the minimal
 * diff that keeps the same API surface callers expect.
 *
 * ## What this DOES
 *
 *   1. `widenOracleAgeLimit(3600s)` — relaxes `FxOracle.maxOracleAge` so any
 *      stale Pyth publishTime on the forked block passes the freshness gate.
 *      Without this, `getMid()` reverts with `OracleTooStale` long before any
 *      HF-driven liquidation logic gets to fire.
 *   2. `disableRedstone(EURC)` + `disableRedstone(USDC)` — zeroes the
 *      `redstoneFeedOf` mapping entries so FxOracle falls back to Pyth-only
 *      pricing. Useful because Redstone's payload-relay is unforked.
 *   3. `evm_mine(1)` — surfaces the new oracle state on the next block read.
 *
 * ## What this DOES NOT DO
 *
 * This helper does NOT push a position into the danger zone. It only
 * normalises the oracle-side preconditions so the rest of a liquidation test
 * has a working oracle to read. Driving the trader's health factor across
 * the liquidation threshold requires writing a synthetic Pyth price — which
 * needs `setPythPrice`, deferred to Wave F5d. See
 * `anvil-helpers/oracle-cheats.ts` `SET_PYTH_PRICE_DEFERRED` and the F5b
 * README.
 *
 * Concretely: tests that need actual HF-driven liquidation (price-driven
 * danger pill, rescind CTA, AccountLiquidated event) stay `test.fixme()`
 * with an `F5d` TODO. The flag-delay-countdown test ALSO stays fixmed at the
 * F5c boundary because no flag-countdown UI exists on this base — the
 * `[data-flag-delay]` selector is part of Wave B's PR #50 which is NOT on
 * `feat/wk1f-anvil-oracle-cheats`. See perps-liquidation.spec.ts.
 *
 * ## Arguments
 *
 *   - `marketId`: kept in the signature to match the F5c task spec, but
 *     unused by the current implementation. When `setPythPrice` lands the
 *     same arg surfaces the target market's feedId.
 *   - `trader`: same — present for API stability, unused today.
 *
 * Both args are validated only as 0x-prefixed hex by the type system; no
 * runtime checks here because tests pass values straight from contract ABIs.
 */
export async function forceLiquidatable(_args: {
  marketId: `0x${string}`;
  trader: Address;
}): Promise<void> {
  const rpcUrl = getAnvilRpcUrl();
  // Token addresses mirror anvil-helpers/oracle-cheats.ts `labelForToken`.
  // Hard-coded here too rather than re-exported because oracle-cheats.ts is
  // F5b territory — we deliberately don't ask it to widen its public surface
  // for a fixture downstream of it.
  const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
  const USDC: Address = "0x3600000000000000000000000000000000000000";

  // 1h freshness window — long enough to swallow any reasonable fork-block
  // staleness without going so far we mask a separate freshness bug in the
  // contract under test.
  await widenOracleAgeLimit({ rpcUrl, newMaxAge: 3600n });
  await disableRedstone({ rpcUrl, token: EURC });
  await disableRedstone({ rpcUrl, token: USDC });
  // Surface the new state on the next read. Without this, getMid() can still
  // see the pre-write oracle config until the next tx mines a block.
  await mineBlocks(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
