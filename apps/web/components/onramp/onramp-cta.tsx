"use client";

/**
 * OnrampCta — the entry-point button that opens the CCTP onramp sheet.
 *
 * Mounted in the trade-island header next to the wallet/balance pill.
 * The button is intentionally small (matches the header chrome) and
 * uses a generic "Deposit USDC" label rather than "Bridge from Fuji"
 * because the user model is "I want USDC on this trading account",
 * not "I want to use Circle's CCTP V2 attestation protocol".
 *
 * Variants:
 *   - default (compact)     → header pill
 *   - empty-state           → block-level CTA card for the margin
 *                             panel when free margin = 0 (used by
 *                             the F1 MarginPanel once it lands)
 */

import { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

import { cn } from "@/utils";
import { Button } from "@/components/ui/button";

import { CctpOnrampSheet } from "./cctp-onramp-sheet";

export interface OnrampCtaProps {
  /**
   * Visual variant. `compact` is the header pill; `block` is the
   * empty-state CTA card used by the F1 margin panel.
   */
  variant?: "compact" | "block";
  /** Override label — defaults to "Deposit USDC". */
  label?: string;
  /** Optional explicit recipient (defaults to the connected wallet). */
  recipient?: `0x${string}`;
  /** Extra class names to compose with the variant defaults. */
  className?: string;
}

export function OnrampCta({
  variant = "compact",
  label = "Deposit USDC",
  recipient,
  className,
}: OnrampCtaProps) {
  const [open, setOpen] = useState(false);

  if (variant === "block") {
    return (
      <>
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-5 text-center",
            className,
          )}
        >
          <div className="text-sm font-bold">No USDC on Arc yet</div>
          <p className="max-w-xs text-xs text-muted-foreground">
            Bridge from Avalanche Fuji in one click — Circle&apos;s CCTP
            V2 attests in &lt;60s on the fast path.
          </p>
          <Button
            type="button"
            className="mt-1"
            onClick={() => setOpen(true)}
          >
            <PlusIcon className="mr-1.5 h-4 w-4" />
            {label}
          </Button>
        </div>
        <CctpOnrampSheet
          open={open}
          onOpenChange={setOpen}
          recipient={recipient}
        />
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("h-8 gap-1.5", className)}
        onClick={() => setOpen(true)}
        title="Bridge USDC from Avalanche Fuji to Arc via Circle CCTP V2"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        <span className="text-xs font-bold">{label}</span>
      </Button>
      <CctpOnrampSheet
        open={open}
        onOpenChange={setOpen}
        recipient={recipient}
      />
    </>
  );
}
