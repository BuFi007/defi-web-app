import "server-only";

/**
 * Base URL of the `@bufi/api` Hono service. Defaults to the conventional
 * local dev port. Override per environment with `BUFI_API_URL`. Kept
 * server-only — these endpoints will eventually take a wallet session
 * cookie and must not be exposed to the client bundle.
 */
const DEFAULT_BASE_URL = "http://localhost:3002";

export function bufiApiUrl(): string {
  return process.env.BUFI_API_URL ?? DEFAULT_BASE_URL;
}

export class BufiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    body: string,
  ) {
    super(`BUFI API ${endpoint} → ${status}: ${body.slice(0, 200)}`);
    this.name = "BufiApiError";
  }
}

/**
 * Typed GET helper. Caller-side `use cache` controls caching — this helper
 * is intentionally cache-agnostic so different fetchers can pick different
 * cacheLife profiles without conflicting.
 */
export async function bufiGet<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, bufiApiUrl());
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Disable Next's per-fetch cache — the wrapping `use cache` block governs.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new BufiApiError(res.status, url.pathname, await res.text());
  }

  return (await res.json()) as T;
}
