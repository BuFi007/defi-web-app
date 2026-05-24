"use client";

/**
 * Decorative Lottie corner accents that frame the Dynamic Island.
 *
 * Resurrects the original `components/lottie-wrapper` corner-decoration
 * pattern (commit e86333c, Nov 2024) — two corner-positioned animated
 * lotties that "border" the central content card. The original was
 * dropped during the trade-island refactor (commit 27d18ab, May 2026
 * "Trade Island mobile redesign") because the lotties spilled into the
 * mobile chart layout. We bring them back, but:
 *
 *   1. Lazy-loaded via `next/dynamic({ ssr: false })` — the `lottie-react`
 *      runtime is ~80 KB and we DON'T want it in the trade-island critical
 *      path. The wrapper itself ships zero lottie code on first paint;
 *      Lottie only loads after hydration.
 *   2. Auto-disabled below the `lg` breakpoint (1024 px). Mobile trade
 *      already uses the full viewport — corner lotties would either
 *      overflow off-screen or land on top of the chart. The mobile
 *      `<MobileTrade />` layout doesn't need decorative chrome.
 *   3. Auto-disabled under `prefers-reduced-motion: reduce` so motion-
 *      sensitive users see the island uncluttered.
 *   4. `aria-hidden` + `pointer-events-none` so the decoration never
 *      intercepts a tap on the wallet popover / market picker corners.
 *   5. Picks ONE lottie per corner at mount (no 30-second swap interval
 *      like the original) to keep the visual quiet — the dynamic-island
 *      morph is the focal animation; the corners are just framing.
 */

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import skullData from "@/public/lottie/skull-lottie.json";
import starData from "@/public/lottie/star-lottie.json";
import coffeeData from "@/public/lottie/coffee.json";
import fuegoData from "@/public/lottie/fuego.json";
import greenManData from "@/public/lottie/green-man.json";
import vampiData from "@/public/lottie/vampi.json";

// next/dynamic + ssr:false matches the canonical lottie pattern across
// the rest of the app (see components/ui/lottie-wrapper.tsx). lottie-react
// touches `document` at module init so it MUST be client-only.
const Lottie = dynamic(() => import("lottie-react"), {
  ssr: false,
}) as React.ComponentType<{
  animationData?: unknown;
  loop?: boolean;
  autoplay?: boolean;
  style?: React.CSSProperties;
}>;

const CORNER_LOTTIES = [
  starData,
  skullData,
  coffeeData,
  fuegoData,
  greenManData,
  vampiData,
] as const;

function pickCornerPair(): [unknown, unknown] {
  // Deterministic-ish "random" so the SAME pair shows for the lifetime
  // of the mount but a refresh shuffles it. Math.random() at module
  // load would lock the pair across the whole bundle — pick at hook
  // time instead.
  const left = CORNER_LOTTIES[Math.floor(Math.random() * CORNER_LOTTIES.length)];
  const right =
    CORNER_LOTTIES[Math.floor(Math.random() * CORNER_LOTTIES.length)];
  return [left, right];
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function useDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return isDesktop;
}

/**
 * Wrap the Dynamic Island with decorative animated lotties at the
 * top-left and bottom-right corners. Children render unchanged — the
 * wrapper just adds a positioned `<div>` ring around them.
 */
export function IslandBorder({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const isDesktop = useDesktopViewport();
  // Pair is picked AFTER hydration so SSR doesn't bake in a `Math.random()`
  // mismatch between server + client renders.
  const [pair, setPair] = useState<[unknown, unknown] | null>(null);
  useEffect(() => {
    setPair(pickCornerPair());
  }, []);

  const shouldRender = isDesktop && !reducedMotion && pair !== null;

  const cornerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      width: 96,
      height: 96,
      pointerEvents: "none",
      zIndex: 1,
      opacity: 0.85,
    }),
    [],
  );

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        // Don't override the island's own align-self / flex; the wrapper
        // is just a positioning context for the corner overlays.
      }}
    >
      {children}
      {shouldRender && pair && (
        <>
          {/* Top-left corner — peeks above the island's curved edge. */}
          <div
            aria-hidden="true"
            style={{
              ...cornerStyle,
              top: -32,
              left: -28,
            }}
          >
            <Lottie
              animationData={pair[0]}
              loop
              autoplay
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          {/* Bottom-right corner — same offset on the opposite diagonal. */}
          <div
            aria-hidden="true"
            style={{
              ...cornerStyle,
              bottom: -32,
              right: -28,
            }}
          >
            <Lottie
              animationData={pair[1]}
              loop
              autoplay
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default IslandBorder;
