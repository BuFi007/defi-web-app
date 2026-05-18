"use client";

import type React from "react";
import type { CSSProperties } from "react";

import dynamic from "next/dynamic";

// Ported from desk-v1's @packages/ui SingleLottieWrapper. lottie-react
// imports document at module init, so it must be client-only — next/dynamic
// + ssr:false matches the upstream pattern verbatim. Two consumption
// modes: inline JSON (animationData object) or remote URL (path string).
const Lottie = dynamic(() => import("lottie-react"), {
  ssr: false,
}) as React.ComponentType<{
  animationData?: unknown;
  path?: string;
  loop?: boolean;
  autoplay?: boolean;
}>;

interface LottieWrapperProps {
  /** Lottie JSON loaded inline (import animation from "./foo.json") OR a
   *  public URL the wrapper will fetch (e.g. "/lottie/skull-lottie.json"). */
  animationData: Record<string, unknown> | string;
  className?: string;
  /** Tailwind width class (e.g. `"w-20"`) — defaults to `w-full`. */
  width?: string;
  /** Tailwind height class — defaults to `h-full`. */
  height?: string;
  loop?: boolean;
  autoplay?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  ariaLabel?: string;
}

export const LottieWrapper: React.FC<LottieWrapperProps> = ({
  animationData,
  className = "",
  width = "w-full",
  height = "h-full",
  loop = true,
  autoplay = true,
  style,
  onClick,
  ariaLabel = "Animation",
}) => {
  const containerClasses = `flex items-center justify-center ${width} ${height} ${className}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onClick) {
      onClick();
    }
  };

  return (
    <div
      className={containerClasses}
      style={style}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
    >
      {animationData &&
        (typeof animationData === "string" ? (
          <Lottie path={animationData} loop={loop} autoplay={autoplay} />
        ) : (
          <Lottie animationData={animationData} loop={loop} autoplay={autoplay} />
        ))}
    </div>
  );
};

/**
 * Canonical names of the lotties bundled under `public/lottie/`.
 * Add a value here when a new .json lands so callers get autocomplete
 * + we get a static check that the asset actually exists.
 */
export type BundledLottie =
  | "chiquito"
  | "coffee"
  | "fuego"
  | "green-man"
  | "green-smile"
  | "process"
  | "skull-lottie"
  | "star-lottie"
  | "sushi"
  | "taco-bug"
  | "vampi"
  | "worm";

export const bundledLottiePath = (name: BundledLottie): string =>
  `/lottie/${name}.json`;
