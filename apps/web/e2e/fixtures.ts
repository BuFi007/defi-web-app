import { type Page, expect } from "@playwright/test";

/**
 * Shared e2e helpers for the BENTO_E2E suite.
 *
 * Two responsibilities:
 *   1. Plant the alpha-gate cookie BEFORE the first navigation so the proxy
 *      doesn't redirect us to /alpha (see apps/web/proxy.ts:30).
 *   2. Goto the home with the `?force-island=1` query param so the
 *      home/index.tsx BENTO_E2E bypass mounts TradeIsland without a wagmi
 *      wallet connection.
 *
 * Both gates are dev-only — the alpha cookie just signals the proxy that
 * the operator opted in, and force-island is dead code in production
 * because NEXT_PUBLIC_BENTO_E2E is unset there.
 */

export const ALPHA_COOKIE_NAME = "bu_alpha_access";
export const API_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3002";

export async function setAlphaCookie(page: Page): Promise<void> {
  // Cookies must be planted on the BASE URL of the page, not just any
  // domain. Browsers ignore cookies for unknown domains pre-navigation, so
  // we set both localhost and 127.0.0.1 to be safe across env diffs.
  await page.context().addCookies([
    {
      name: ALPHA_COOKIE_NAME,
      value: "true",
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: ALPHA_COOKIE_NAME,
      value: "true",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

interface GotoIslandOptions {
  /**
   * Query string appended to the root URL. The BENTO_E2E bypass requires
   * `?force-island=1` to actually mount TradeIsland; callers can extend
   * the search to switch the default arcade/tab if needed.
   */
  search?: string;
  /** Wait for the trade-island tab strip to be visible. Defaults true. */
  waitForIsland?: boolean;
}

export async function gotoIsland(
  page: Page,
  { search = "?force-island=1", waitForIsland = true }: GotoIslandOptions = {},
): Promise<void> {
  await setAlphaCookie(page);
  await page.goto(`/${search}`, { waitUntil: "domcontentloaded" });

  if (waitForIsland) {
    // The island header renders the trade/loan/positions tabs as buttons
    // with class `island-tab`. Mounting that strip means home/index.tsx
    // resolved through the BENTO_E2E bypass and TradeIsland is live.
    await expect(page.locator(".island-tab").first()).toBeVisible({
      timeout: 20_000,
    });
  }
}

/**
 * Fetch the dev simulator API directly. Used by arcade-bento-e2e to assert
 * the commit-reveal pipeline actually reached the backend (not just that
 * the UI advanced state).
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function apiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
