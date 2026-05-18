"use client";

import * as React from "react";
import Image from "next/image";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

// Mirrors desk-v1's kawaii tooltip variants. Each variant ships a small
// mascot icon next to the message. Defaults to "happy".
export type TooltipVariant =
  | "yellowCoin"
  | "sneeze"
  | "purpleCoin"
  | "money"
  | "happy"
  | "curious";

interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
  variant?: TooltipVariant;
}

const VARIANT_ASSET: Record<TooltipVariant, { src: string; alt: string }> = {
  yellowCoin: { src: "/assets/info-bu/yellow-coin-bu.png", alt: "Yellow coin" },
  sneeze: { src: "/assets/info-bu/sneeze-bu.png", alt: "Sneeze" },
  purpleCoin: { src: "/assets/info-bu/purple-coin-bu.svg", alt: "Purple coin" },
  money: { src: "/assets/info-bu/money-bu.png", alt: "Money" },
  happy: { src: "/assets/info-bu/happy-bu.png", alt: "Happy" },
  curious: { src: "/assets/info-bu/curious-bu.png", alt: "Curious" },
};

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(
  (
    { className, sideOffset = 6, variant = "happy", children, ...props },
    ref,
  ) => {
    const asset = VARIANT_ASSET[variant];
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            // Brand: white card with kawaii pill radius. Dark mode picks
            // up shadow + border hairline. Animations follow Radix data-
            // side state changes. Text is text-purpleDanis (brand purple)
            // — replaces the legacy text-main which rendered as yellow on
            // the current theme.
            "z-[100] max-w-[320px] overflow-hidden rounded-2xl border border-purpleDanis/20 bg-white px-3 py-2 text-xs font-bold text-purpleDanis shadow-lg",
            "dark:bg-black dark:text-violetDanis dark:border-violetDanis/30",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          <div className="flex items-center gap-2">
            <Image
              src={asset.src}
              alt={asset.alt}
              width={20}
              height={20}
              className="size-5 shrink-0"
            />
            <div className="leading-snug">{children}</div>
          </div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    );
  },
);
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
