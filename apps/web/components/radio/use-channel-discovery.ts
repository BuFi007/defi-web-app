"use client";

import { useEffect, useState } from "react";
import { CHANNELS, type Channel } from "./channels";

type DiscoveryStatus = "idle" | "loading" | "ready" | "error";

export type ResolvedChannel = Channel & {
  /** The effective videoId to play (from `videoId` or discovery resolution). null = not playable yet. */
  effectiveVideoId: string | null;
};

/**
 * Resolves query-based channels via /api/radio/discover. Channels with
 * a hardcoded `videoId` are returned immediately; channels with a `query`
 * are resolved once the discovery response lands.
 *
 * Unresolved channels (no API key, query returned no live results) have
 * `effectiveVideoId: null` and should be filtered out of the scroller.
 */
export function useChannelDiscovery() {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<DiscoveryStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    const queryChannels = CHANNELS.filter((c) => c.query && !c.videoId);
    if (queryChannels.length === 0) {
      setStatus("ready");
      return;
    }

    setStatus("loading");
    fetch("/api/radio/discover")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setResolved(data?.resolved ?? {});
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const channels: ResolvedChannel[] = CHANNELS.map((c) => ({
    ...c,
    effectiveVideoId: c.videoId ?? resolved[c.id] ?? null,
  }));

  return { channels, status };
}
