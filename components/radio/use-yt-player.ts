"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: any) => YTPlayer;
      PlayerState: { PLAYING: 1; PAUSED: 2; ENDED: 0; BUFFERING: 3 };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string) => void;
  getPlayerState: () => number;
  destroy: () => void;
};

let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const existing = document.querySelector(
      'script[src*="youtube.com/iframe_api"]',
    );
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve();
    };
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return apiLoadPromise;
}

export function useYouTubePlayer({
  videoId,
  onStateChange,
  onError,
}: {
  videoId: string;
  onStateChange?: (state: number) => void;
  onError?: (code: number) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const lastVideoId = useRef(videoId);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then(() => {
      if (cancelled || !mountRef.current || playerRef.current) return;
      playerRef.current = new window.YT!.Player(mountRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          disablekb: 1,
        },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e: { data: number }) => {
            onStateChange?.(e.data);
          },
          onError: (e: { data: number }) => {
            onError?.(e.data);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // intentionally only on mount — videoId changes go through loadVideoById below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    if (videoId === lastVideoId.current) return;
    playerRef.current.loadVideoById(videoId);
    lastVideoId.current = videoId;
  }, [videoId, ready]);

  return {
    mountRef,
    player: playerRef.current,
    ready,
  };
}
