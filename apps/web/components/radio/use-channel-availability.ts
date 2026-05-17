"use client";

import { useCallback, useEffect, useState } from "react";
import { CHANNELS } from "./channels";

/**
 * Detects which YouTube channels in CHANNELS are currently embeddable.
 *
 * Strategy:
 * 1. On mount, try the localStorage cache first. If fresh (< 24h), skip
 *    the network entirely — we already know which channels were down
 *    yesterday and the answer rarely changes within 24h.
 * 2. On cache miss / stale: hit YouTube's oEmbed endpoint in parallel.
 *    200 = exists + embeddable; any non-2xx = filter out. Free, no API
 *    key, CORS-friendly.
 * 3. At play time, the iframe player's `onError` (codes 2/100/101/150)
 *    catches anything that slipped past oEmbed (e.g. live stream ended
 *    but archive remains). `markUnavailable(id)` updates state AND the
 *    persistent cache so future mounts learn from it too.
 */

const STORAGE_KEY = "bufi-radio-unavail";
const TTL_MS = 24 * 60 * 60 * 1000;

type CacheShape = {
  unavailable: string[];
  checkedAt: number;
};

function readCache(): CacheShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (
      !parsed ||
      typeof parsed.checkedAt !== "number" ||
      !Array.isArray(parsed.unavailable)
    ) {
      return null;
    }
    if (Date.now() - parsed.checkedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(unavailable: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        unavailable: [...unavailable],
        checkedAt: Date.now(),
      } satisfies CacheShape),
    );
  } catch {
    // localStorage can be disabled / over-quota; degrade silently.
  }
}

export function useChannelAvailability() {
  const [unavailable, setUnavailable] = useState<Set<string>>(() => {
    const cached = readCache();
    return cached ? new Set(cached.unavailable) : new Set();
  });
  const [checked, setChecked] = useState<boolean>(() => readCache() !== null);

  useEffect(() => {
    // Cache fresh — skip the oEmbed fan-out entirely.
    if (readCache() !== null) return;

    let cancelled = false;

    const check = async () => {
      // Only verify channels with a hardcoded videoId; query-based channels
      // resolve at play time via /api/radio/discover and shouldn't ping oEmbed
      // with `v=undefined` (returns 400 + console noise).
      const verifiable = CHANNELS.filter((c) => Boolean(c.videoId));
      const results = await Promise.allSettled(
        verifiable.map(async (c) => {
          const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${c.videoId}&format=json`;
          const res = await fetch(url, { method: "GET", cache: "force-cache" });
          return { id: c.id, ok: res.ok };
        }),
      );

      if (cancelled) return;

      const down = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled" && !r.value.ok) {
          down.add(r.value.id);
        }
        // Network errors → leave the channel in; iframe onError will catch
        // genuinely dead ones at play time.
      }

      setUnavailable(down);
      writeCache(down);
      setChecked(true);
    };

    check();

    return () => {
      cancelled = true;
    };
  }, []);

  const markUnavailable = useCallback((id: string) => {
    setUnavailable((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      // Persist the iframe-detected failure so next mount won't try it.
      writeCache(next);
      return next;
    });
  }, []);

  return { unavailable, markUnavailable, checked };
}
