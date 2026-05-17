"use client";

import type { ReactNode } from "react";

export function Hint({
  children,
  w = 220,
  side = "top",
}: {
  children: ReactNode;
  w?: number;
  side?: "top" | "bottom" | "left";
}) {
  return (
    <span className={"zen-hint zen-hint-" + side} tabIndex={0}>
      <svg className="zen-hint-icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M9.6 9.4a2.4 2.4 0 0 1 4.8 0c0 1.3-2.4 1.7-2.4 3.2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="12" cy="16.2" r="0.95" fill="currentColor" />
      </svg>
      <span className="zen-hint-tip" style={{ width: w }}>
        {children}
      </span>
    </span>
  );
}
