import { type Page, expect } from "@playwright/test";

export const API_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3002";

interface GotoIslandOptions {
  search?: string;
  waitForIsland?: boolean;
}

export async function gotoIsland(
  page: Page,
  { search = "?force-island=1", waitForIsland = true }: GotoIslandOptions = {},
): Promise<void> {
  await page.goto(`/${search}`, { waitUntil: "domcontentloaded" });

  if (waitForIsland) {
    await expect(page.locator(".island-tab").first()).toBeVisible({
      timeout: 20_000,
    });
  }
}

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
