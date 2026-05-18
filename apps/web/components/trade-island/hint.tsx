"use client";

import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipVariant,
} from "@/components/ui/tooltip";

/**
 * Inline help-icon paired with a kawaii tooltip — the canonical BUFI
 * tooltip surface for tabular labels and form fields. Wraps
 * components/ui/tooltip which ships variant icons.
 *
 * `w` is preserved from the legacy zen-hint API to limit ripple across
 * dozens of call sites; it maps to a max-width on the tooltip content.
 * `side` and `variant` are passed through.
 */
export function Hint({
  children,
  w = 280,
  side = "top",
  variant = "happy",
}: {
  children: ReactNode;
  /** Max-width in px for the tooltip body. */
  w?: number;
  side?: "top" | "bottom" | "left" | "right";
  variant?: TooltipVariant;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="zen-hint-trigger"
          tabIndex={0}
          role="button"
          aria-label="Help"
        >
          <svg
            className="zen-hint-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M9.6 9.4a2.4 2.4 0 0 1 4.8 0c0 1.3-2.4 1.7-2.4 3.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="12" cy="16.2" r="0.95" fill="currentColor" />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} variant={variant} style={{ maxWidth: w }}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
