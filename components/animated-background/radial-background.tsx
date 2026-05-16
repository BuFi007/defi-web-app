"use client";

import { cn } from "@/utils";

interface RadialBackgroundProps {
  className?: string;
}

export const RadialBackground = ({ className }: RadialBackgroundProps) => (
  <div
    aria-hidden="true"
    className={cn(
      "pointer-events-none bg-radial-lightPurple dark:bg-radial-darkPurple",
      className,
    )}
  />
);

export default RadialBackground;
