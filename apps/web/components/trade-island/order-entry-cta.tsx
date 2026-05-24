"use client";

/**
 * Dual Buy/Sell (Long/Short) CTA with progress-aware labels.
 *
 * State machine driven by props from the order-entry parent:
 *
 *   idle        → "Buy" / "Sell" (or "Long" / "Short")
 *   simulating  → "Validating…" + 3-dot pulse
 *   submitting  → "Confirming…" + indeterminate progress bar
 *   filled      → brief "Filled ✓" flash, auto-reverts to idle
 *   error       → CTA back to idle; revert reason rendered by OrderFeedback
 *
 * The whole point of this component is to keep the button label honest:
 * users never see "Signing…" before the wallet popup has actually been
 * fired. While we're in simulate-phase the label says "Validating…" so
 * they know we're checking the chain BEFORE asking for a signature.
 */

import { useState } from "react";

import { Icon } from "./data";

export interface OrderEntryCTAProps {
  /** "Buy" / "Long" — the long-side label. */
  longLabel: string;
  /** "Sell" / "Short" — the short-side label. */
  shortLabel: string;
  /** Side the chart pre-armed (mobile sticky CTA hint). Drives the .primed class. */
  primedSide?: "long" | "short" | null;
  /** True iff the parent's submit-validity gate is closed (size > 0, market loaded, etc.). */
  disabled: boolean;
  /** Active during `simulateContract` — no wallet popup yet. */
  simulating: boolean;
  /** Active after sign — awaiting on-chain confirm. */
  submitting: boolean;
  /** Briefly true after `MatchSettled` / receipt. Flashes "Filled". */
  justFilled?: boolean;
  /** True iff the last attempt errored (sim revert or user reject). Lets caller hide the
   *  "Filled" flash on subsequent submits. */
  hadError?: boolean;
  /** Click handler — caller dispatches the actual mutation. */
  onSubmit: (side: "long" | "short") => void;
}

export function OrderEntryCTA({
  longLabel,
  shortLabel,
  primedSide,
  disabled,
  simulating,
  submitting,
  justFilled,
  hadError,
  onSubmit,
}: OrderEntryCTAProps) {
  // Track which side actually fired the in-flight action so the spinner
  // only shows on the clicked button, not both. We don't reset via an
  // effect (eslint react-hooks/set-state-in-effect) — instead, the
  // `busy` boolean below is the source of truth for any spinner UI;
  // `busySide` only persists the user-clicked side so a follow-up "Filled"
  // flash can target the right button. Once `busy` flips false the
  // busySide value is effectively ignored by `isMyBusy` below.
  const [busySide, setBusySide] = useState<"long" | "short" | null>(null);
  const busy = simulating || submitting;

  const labelFor = (side: "long" | "short", base: string): string => {
    if (busySide && busySide !== side) return base;
    if (simulating) return "Validating…";
    if (submitting) return "Confirming…";
    if (justFilled && !hadError) return "Filled ✓";
    return base;
  };

  const renderButton = (side: "long" | "short", base: string) => {
    const cls =
      side +
      (primedSide === side ? " primed" : "") +
      (busy && busySide === side ? " is-busy" : "") +
      (justFilled && !hadError && busySide === side ? " is-filled" : "");
    const label = labelFor(side, base);
    const isMyBusy = busy && busySide === side;
    return (
      <button
        key={side}
        type="button"
        className={cls}
        disabled={disabled || busy}
        onClick={() => {
          setBusySide(side);
          onSubmit(side);
        }}
        aria-busy={isMyBusy}
        aria-live="polite"
        data-primed={primedSide === side ? "true" : undefined}
        data-state={
          isMyBusy
            ? simulating
              ? "simulating"
              : "submitting"
            : justFilled && !hadError && busySide === side
              ? "filled"
              : "idle"
        }
      >
        <Icon name="sparkle" size={14} />
        <span className="cta-label">{label}</span>
        {isMyBusy && <ProgressDots simulating={simulating} />}
      </button>
    );
  };

  return (
    <>
      <div className="long-short">
        {renderButton("long", longLabel)}
        {renderButton("short", shortLabel)}
      </div>
      {busy && (
        <div
          className="cta-progress-track"
          aria-hidden
          style={{
            marginTop: 6,
            height: 2,
            borderRadius: 999,
            overflow: "hidden",
            background: "rgba(127, 127, 127, 0.12)",
          }}
        >
          <div
            className={
              "cta-progress-bar " + (simulating ? "indeterminate" : "filling")
            }
            style={{
              height: "100%",
              background:
                "linear-gradient(90deg, var(--primary, #6366f1), var(--profit-ink, #10b981))",
              width: simulating ? "30%" : "65%",
              borderRadius: 999,
              animation: simulating
                ? "cta-progress-slide 1.2s ease-in-out infinite"
                : "cta-progress-pulse 1.4s ease-in-out infinite",
            }}
          />
          <style jsx>{`
            @keyframes cta-progress-slide {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(180%); }
              100% { transform: translateX(380%); }
            }
            @keyframes cta-progress-pulse {
              0%, 100% { opacity: 0.55; }
              50% { opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}

function ProgressDots({ simulating }: { simulating: boolean }) {
  return (
    <span
      className="cta-dots mono"
      aria-hidden
      style={{ marginLeft: 6, letterSpacing: 1, opacity: 0.85 }}
    >
      <span
        className="dot"
        style={{
          animation: "cta-dot-bounce 1s infinite",
          animationDelay: "0s",
        }}
      >
        .
      </span>
      <span
        className="dot"
        style={{
          animation: "cta-dot-bounce 1s infinite",
          animationDelay: "0.18s",
        }}
      >
        .
      </span>
      <span
        className="dot"
        style={{
          animation: "cta-dot-bounce 1s infinite",
          animationDelay: "0.36s",
        }}
      >
        .
      </span>
      <style jsx>{`
        @keyframes cta-dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-2px); opacity: 1; }
        }
      `}</style>
      {/* Label-only marker so screen readers know we're mid-sim, not mid-submit */}
      <span className="sr-only" style={{ position: "absolute", left: -9999 }}>
        {simulating ? "Validating on chain" : "Awaiting confirmation"}
      </span>
    </span>
  );
}
