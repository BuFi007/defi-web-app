"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/utils";

import { LottieWrapper, bundledLottiePath, type BundledLottie } from "./lottie-wrapper";

interface EmptyStateProps {
  /** Big bold headline. Required — every empty state needs a "what's missing". */
  title: string;
  /** Optional secondary line. Plain string or rich React content. */
  description?: ReactNode;
  /** Optional inline action — e.g. a connect-wallet CTA. */
  action?: ReactNode;
  /**
   * Decoration above the title. Pick ONE:
   *   • `lottie="skull-lottie"` — one of the bundled animations under
   *     public/lottie/ (statically validated via `BundledLottie`).
   *   • `icon={<MySVG />}` — any React node, sized by the consumer.
   * If both are passed, lottie wins. If neither, the empty state
   * renders without a decoration (still readable).
   */
  lottie?: BundledLottie;
  icon?: ReactNode;
  /** Size of the lottie / icon container. Defaults to 96 px. */
  decorationSize?: number;
  /** Pad-top/pad-bottom override — defaults are tuned for in-card
   *  surfaces (Positions / History / Leaderboard). */
  className?: string;
  /** Extra style passthrough for tight one-off positioning. */
  style?: CSSProperties;
}

/**
 * Brand-aware empty state. One component, every "no data here yet"
 * surface in the trade island flows through it so:
 *   - Copy is consistent (title + description, no ad-hoc <p className="muted">).
 *   - A Lottie can be added without touching the call site — drop a
 *     `lottie="vampi"` prop and the wrapper handles dynamic import,
 *     SSR skip, and aspect.
 *   - Future visual passes hit ONE component instead of N copies.
 *
 * Lottie picks per surface (current convention):
 *   - "Connect a wallet" gates                 → green-man (welcoming)
 *   - "No closed trades yet"                   → coffee (waiting)
 *   - "No open positions"                      → chiquito (chill)
 *   - "Leaderboard launching"                  → star-lottie
 *   - "No loan / borrow positions"             → vampi
 *   - error surfaces                           → skull-lottie / fuego
 */
export function EmptyState({
  title,
  description,
  action,
  lottie,
  icon,
  decorationSize = 96,
  className,
  style,
}: EmptyStateProps) {
  const hasDecoration = Boolean(lottie) || Boolean(icon);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 px-4 py-8",
        "text-purpleDanis dark:text-violetDanis",
        className,
      )}
      style={style}
      role="status"
      aria-live="polite"
    >
      {hasDecoration && (
        <div
          className="shrink-0"
          style={{ width: decorationSize, height: decorationSize }}
        >
          {lottie ? (
            <LottieWrapper
              animationData={bundledLottiePath(lottie)}
              ariaLabel={title}
            />
          ) : (
            icon
          )}
        </div>
      )}
      <div className="font-bold text-base leading-tight">{title}</div>
      {description != null && (
        <div className="text-xs font-semibold opacity-80 max-w-[42ch] leading-snug">
          {description}
        </div>
      )}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  );
}
