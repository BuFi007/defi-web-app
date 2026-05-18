"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/utils";

/**
 * shadcn-style Slider on top of Radix, themed to match the BU.FI Trade Island
 * purple `.slider`/`.track`/`.thumb` styles in styles.css. Drop-in for the old
 * custom div-based slider — it actually moves on hold.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--surface-3)]">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--primary)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "block h-4 w-4 rounded-full bg-[var(--primary)]",
        "shadow-[0_0_0_4px_rgba(107,91,255,0.18)]",
        "ring-2 ring-[var(--surface)]",
        "transition-[transform,box-shadow] duration-150 ease-out",
        "hover:scale-110 active:scale-105 active:shadow-[0_0_0_8px_rgba(107,91,255,0.22)]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--primary)]/40",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
