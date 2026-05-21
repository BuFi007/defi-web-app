"use client";

import { useEffect } from "react";

import { api } from "@/lib/api-client";

/**
 * Invisible-mount consumer of the typed BFF pipe (`hc<AppType>`).
 *
 * Purpose: prove end-to-end type inference across the workspace boundary
 * (apps/api → @bufi/api → apps/web). This component is the first wired
 * call against the `/health` route after the wk1d1 Hono-typed-RPC pipe
 * landed; it's intentionally trivial.
 *
 * Side effects:
 *   - Fires `api.health.$get()` once after mount.
 *   - Mirrors the result onto `<html data-api-status="ok|down|loading">`
 *     so Playwright / QA can wait on the attribute instead of polling
 *     `/health` themselves. Loading is the default — never wiped on
 *     unmount to keep the attribute stable across navigations.
 *   - `console.warn` on failure so dev-tools surfaces a broken API
 *     without throwing into the React tree.
 *
 * Why not a Suspense / TanStack Query: the goal is to validate the
 * typed pipe, not to gate render on it. A failing API must not block
 * the marketing/home page from rendering.
 */
export function ApiHealthBeacon(): null {
  useEffect(() => {
    let cancelled = false;
    const root = document.documentElement;
    root.dataset.apiStatus = root.dataset.apiStatus ?? "loading";

    void (async () => {
      try {
        const res = await api.health.$get();
        if (cancelled) return;
        if (!res.ok) {
          root.dataset.apiStatus = "down";
          console.warn("[api-health-beacon] non-2xx", res.status);
          return;
        }
        const body = await res.json();
        // body is inferred as { status: "ok"; uptime: number; version: string }
        // from apps/api's HealthResponse zod schema — no manual cast.
        root.dataset.apiStatus = body.status;
        if (process.env.NODE_ENV === "development") {
          console.info(
            `[api-health-beacon] api v${body.version} up ${body.uptime.toFixed(0)}s`,
          );
        }
      } catch (err) {
        if (cancelled) return;
        root.dataset.apiStatus = "down";
        console.warn("[api-health-beacon] fetch failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

export default ApiHealthBeacon;
