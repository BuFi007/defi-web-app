"use client";

import { useEffect, useRef } from "react";

/**
 * Module-level cache. One <audio> element per src — shared across every
 * consumer of the same file and surviving component remounts / HMR.
 *
 *  - `preload="auto"` makes the browser start fetching as soon as the src
 *    is registered, so the first hover doesn't pay a network round-trip.
 *  - Construction is deferred to a useEffect (never during render or SSR)
 *    so `new Audio()` doesn't run on the server.
 *  - Multiple components hovering the same logo share decode state — the
 *    file is downloaded and decoded exactly once for the document's life.
 */
const audioCache = new Map<string, HTMLAudioElement>();

function getOrCreateAudio(src: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const cached = audioCache.get(src);
  if (cached) return cached;
  const audio = new Audio(src);
  audio.preload = "auto";
  audioCache.set(src, audio);
  return audio;
}

// Minimum gap between two plays of the same wrapper instance. Stops a
// `while(true) dispatchEvent('mouseenter')` from pinning the decoder thread.
const PLAY_DEBOUNCE_MS = 80;

export function useHoverAudio(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedRef = useRef(0);

  useEffect(() => {
    audioRef.current = getOrCreateAudio(src);
  }, [src]);

  const playHoverSound = () => {
    const now = performance.now();
    if (now - lastPlayedRef.current < PLAY_DEBOUNCE_MS) return;
    lastPlayedRef.current = now;

    const audio = audioRef.current ?? getOrCreateAudio(src);
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch((err) => {
      // Most common cause is autoplay policy before first user gesture —
      // the next gesture will succeed. Quiet in prod, surface in dev.
      if (process.env.NODE_ENV !== "production") {
        console.warn("Hover audio failed:", err);
      }
    });
  };

  const resetHoverSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  return { playHoverSound, resetHoverSound };
}
