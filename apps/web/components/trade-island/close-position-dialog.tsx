"use client";

/**
 * ClosePositionDialog — confirmation surface for closing (or partial-
 * closing) an open perp position.
 *
 * A close is a reduce-only ORDER that takes the OPPOSITE side of the
 * position. Long → reduce-only sell. Short → reduce-only buy. The
 * matcher settles it the same way as a regular opening order; the
 * only difference is `reduceOnly = true`, which prevents the order
 * from accidentally flipping the position past zero into the opposite
 * side.
 *
 * UX:
 *   - Opens prefilled with `size = positionSize` (100% close).
 *   - User can edit the size for a partial close. 25/50/75/100% chips
 *     shortcut the common cases.
 *   - Submits as a MARKET order so a single click closes the position
 *     against the live mark; a limit-close would require a price input
 *     and would just sit in the queue otherwise.
 *   - Uses `useOptimisticPlaceOrder` so the positions list reflects
 *     the pending close immediately; rollback fires on revert.
 *
 * Pre-flight reverts (sim-only) catch: `NotOrderOwner`, expired
 * deadlines, reduce-only against a flat book, etc. — surfaced inline
 * via `<OrderFeedback>` so the user sees the decoded reason BEFORE the
 * wallet popup.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import { OrderFeedback } from "./order-feedback";
import { fmtUSD } from "./data";
import { useOptimisticPlaceOrder } from "@/lib/perps/use-optimistic-position";
import { prettifySimError, type SimError } from "@/lib/web3/use-simulated-write";

export interface ClosePositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The `marketId` (bytes32) of the position being closed. */
  marketId: string | undefined;
  /** Human label for the market (e.g. "EURC/USDC"). */
  symbol: string;
  /** Position side. The close goes the OPPOSITE direction. */
  side: "long" | "short";
  /** Position notional in USDC (decimal float). */
  sizeUsdc: number;
  /** Position leverage — passed through to the close order so the
   *  matcher's required-margin math stays consistent. */
  leverage: number;
  /** Current mark / entry — used for the optimistic row entry price
   *  proxy and the impact preview. */
  markPriceFloat?: number;
}

const PRESETS = [25, 50, 75, 100] as const;

export function ClosePositionDialog({
  open,
  onOpenChange,
  marketId,
  symbol,
  side,
  sizeUsdc,
  leverage,
  markPriceFloat,
}: ClosePositionDialogProps) {
  const { toast } = useToast();
  const placeOrder = useOptimisticPlaceOrder();

  // Pct slider over the 0–100% close range. Default 100 = full close
  // — that's the dominant case; partial close is the affordance.
  const [pct, setPct] = useState(100);
  const [simError, setSimError] = useState<SimError | null>(null);

  // Reset state on each dialog open so a previous error doesn't bleed
  // across sessions. Dialog close-then-reopen should feel pristine.
  useEffect(() => {
    if (open) {
      setPct(100);
      setSimError(null);
    }
  }, [open]);

  const closeSizeUsdc = useMemo(() => {
    const raw = (sizeUsdc * pct) / 100;
    // Round to 6 decimal places — USDC's native precision — so the
    // backend sees the same string we render and there's no float-
    // rounding drift between the preview and the signed intent.
    return Number(raw.toFixed(6));
  }, [sizeUsdc, pct]);

  // The order to send. Reduce-only + market + opposite side. The
  // matcher reads `reduceOnly` and refuses to flip the position past
  // zero, so a partial-close that overshoots the position size gets
  // capped automatically at the contract layer.
  const closeSide: "long" | "short" = side === "long" ? "short" : "long";

  const disabled =
    !marketId ||
    closeSizeUsdc <= 0 ||
    placeOrder.isPending;

  const onSubmit = async () => {
    if (!marketId) return;
    setSimError(null);
    try {
      const result = await placeOrder.mutateAsync({
        marketId,
        side: closeSide,
        sizeUsdc: closeSizeUsdc.toString(),
        leverage,
        orderType: "market",
        priceE18: "0",
        reduceOnly: true,
        postOnly: false,
        markPriceFloat,
      });
      toast({
        title: pct === 100 ? "Position closing" : "Reducing position",
        description: `${symbol} · MARKET · intent ${shortDigest(result.digest)}`,
      });
      onOpenChange(false);
    } catch (error) {
      const pretty = prettifySimError(error);
      setSimError(pretty);
      toast({
        variant: "destructive",
        title: pretty.reason ? `Would revert: ${pretty.reason}` : "Close failed",
        description: errMsg(error),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            Close {pct === 100 ? "" : `${pct}% of `}position
          </DialogTitle>
          <DialogDescription>
            {symbol} · {side.toUpperCase()} · {leverage}x · Market order at the
            current mark price.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <div className="field-label">
              <span>Size to close</span>
              <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
                {fmtUSD(closeSizeUsdc)} USDC
                {pct < 100 ? ` (${pct}%)` : ""}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label="Percent of position to close"
              style={{ width: "100%" }}
            />
            <div
              className="size-pcts"
              style={{
                display: "flex",
                gap: 6,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: pct === p ? "1px solid var(--primary)" : "1px solid var(--ink-soft, rgba(127,127,127,0.18))",
                    background:
                      pct === p
                        ? "var(--ink-soft, rgba(99, 102, 241, 0.12))"
                        : "transparent",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>

          <div
            className="impact"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: "var(--ink-soft, rgba(127, 127, 127, 0.06))",
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)" }}>Closing</span>
              <span className="mono">
                {fmtUSD(closeSizeUsdc)} USDC · {pct === 100 ? "full close" : "partial"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)" }}>Mark price</span>
              <span className="mono">
                {markPriceFloat && Number.isFinite(markPriceFloat)
                  ? markPriceFloat.toFixed(markPriceFloat < 10 ? 4 : 2)
                  : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)" }}>Order side</span>
              <span
                className="mono"
                style={{
                  color:
                    closeSide === "long"
                      ? "var(--profit-ink)"
                      : "var(--loss-ink)",
                  fontWeight: 800,
                }}
              >
                {closeSide.toUpperCase()} (reduce-only)
              </span>
            </div>
          </div>

          <OrderFeedback
            simError={simError}
            onDismiss={() => setSimError(null)}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={placeOrder.isPending}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--ink-soft, rgba(127,127,127,0.18))",
                background: "transparent",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12.5,
                color: "var(--ink-3)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={disabled}
              aria-busy={placeOrder.isPending}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: 0,
                background: "var(--loss-ink, #ef4444)",
                color: "white",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                fontWeight: 800,
                fontSize: 12.5,
              }}
            >
              {placeOrder.isPending
                ? "Closing…"
                : pct === 100
                  ? "Close position"
                  : `Close ${pct}%`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function shortDigest(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}
