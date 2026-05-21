/**
 * Shared API base URL resolution for the integrator dashboard (Wave I4).
 *
 * Mirrors the pattern already used by lib/perps/replacement-agent.ts —
 * `NEXT_PUBLIC_API_URL` is the canonical env var, with
 * `NEXT_PUBLIC_BUFI_API_URL` kept as a legacy fallback so older `.env` files
 * keep working. The localhost default keeps `bun run dev` self-contained.
 */

const DEFAULT_API_URL = "http://localhost:8787";

export function dashboardApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL ??
    DEFAULT_API_URL
  );
}

export function dashboardApiUrl(path: string): string {
  const base = dashboardApiBaseUrl();
  return new URL(path, base).toString();
}
