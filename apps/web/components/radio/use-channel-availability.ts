"use client";

import { useCallback, useEffect, useState } from "react";
import { CHANNELS } from "./channels";

/**
 * Detects which YouTube channels in CHANNELS are currently embeddable.
 *
 * Strategy:
 * 1. On mount, hit YouTube's oEmbed endpoint in parallel. 200 = exists +
 *    embeddable; any non-2xx = filter out. Free, no API key, CORS-friendly.
 * 2. At play time, the iframe player's `onError` (codes 2/100/101/150)
 *    catches anything that slipped past oEmbed (e.g. live stream ended
 *    but archive remains). `markUnavailable(id)` is called from there.
 */
export function useChannelAvailability() {
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);

  useEffect(() => {
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
      return next;
    });
  }, []);

  return { unavailable, markUnavailable, checked };
}
