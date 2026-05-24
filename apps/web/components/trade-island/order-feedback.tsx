"use client";

/**
 * Inline revert-reason surface for perp writes. Renders the decoded
 * custom-error name + viem's metaMessages list so the user sees exactly
 * which contract check would have failed BEFORE they sign anything.
 *
 * Three render modes:
 *   - `mode="sim"`     — simulateContract would revert (no popup fired)
 *   - `mode="reject"`  — user rejected the wallet popup
 *   - `mode="confirm"` — tx submitted, awaiting confirm (progress, not error)
 *
 * Pairs with `OrderEntryCTA` (which renders the button states) — the CTA
 * fires the action; this card explains why it didn't go through.
 */

import { useEffect, useState } from "react";

import type { SimError } from "@/lib/web3/use-simulated-write";
import { Icon } from "./data";

export type OrderFeedbackMode = "sim" | "reject" | "confirm" | "idle";

export interface OrderFeedbackProps {
  /** When non-null, render the revert reason. */
  simError?: SimError | null;
  /** Optional CTA to dismiss the message. */
  onDismiss?: () => void;
  /** Force a particular render mode. Defaults to "sim" when simError set. */
  mode?: OrderFeedbackMode;
  /** Hide after N ms; defaults to never auto-hiding. */
  autoHideMs?: number;
}

// Internal body component — keyed on the simError identity from the
// outer wrapper so a fresh error fully remounts and resets the auto-hide
// state. This sidesteps the react-hooks/set-state-in-effect lint by
// using the parent's `key` prop as the reset mechanism instead of an
// in-effect setState call.
function OrderFeedbackBody({
  simError,
  onDismiss,
  mode,
  autoHideMs,
}: OrderFeedbackProps & { simError: SimError }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!autoHideMs) return;
    const t = setTimeout(() => setHidden(true), autoHideMs);
    return () => clearTimeout(t);
  }, [autoHideMs]);

  if (hidden) return null;
  const effectiveMode: OrderFeedbackMode = mode ?? "sim";
  const tone = effectiveMode === "confirm" ? "info" : "warn";
  const reason = simError.reason;
  // Title is the decoded custom-error name when viem gave us one, else
  // the prettified short message. Either way it's a one-liner that fits
  // inline next to the order entry CTA.
  const title = reason
    ? `Would revert: ${reason}`
    : simError.short;
  const body = simError.full && simError.full !== simError.short ? simError.full : null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`order-feedback ${tone}`}
      data-mode={effectiveMode}
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background:
          tone === "warn"
            ? "var(--loss-bg, rgba(239, 68, 68, 0.08))"
            : "var(--ink-soft, rgba(99, 102, 241, 0.08))",
        border: `1px solid ${
          tone === "warn"
            ? "var(--loss-border, rgba(239, 68, 68, 0.25))"
            : "var(--ink-border, rgba(99, 102, 241, 0.25))"
        }`,
        fontSize: 12,
        lineHeight: 1.45,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span
        className="of-icon"
        aria-hidden
        style={{
          flex: "0 0 auto",
          marginTop: 1,
          color:
            tone === "warn" ? "var(--loss-ink, #ef4444)" : "var(--ink, #6366f1)",
        }}
      >
        <Icon name="info" size={14} />
      </span>
      <div className="of-body" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="of-title mono"
          style={{
            fontWeight: 600,
            color:
              tone === "warn"
                ? "var(--loss-ink, #ef4444)"
                : "var(--ink, #6366f1)",
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        {body && (
          <div
            className="of-meta mono"
            style={{
              marginTop: 4,
              color: "var(--muted, #888)",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {body}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="of-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            flex: "0 0 auto",
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "var(--muted, #888)",
            padding: 2,
            lineHeight: 0,
          }}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Public wrapper. Gates on simError presence and remounts the body
 * component on identity change via a key — this is how the auto-hide
 * timer resets between consecutive errors without an in-effect setState.
 */
export function OrderFeedback(props: OrderFeedbackProps) {
  if (!props.simError) return null;
  // Stable key derived from the error's short message + reason. New
  // error → new key → fresh OrderFeedbackBody mount with hidden=false.
  const keyHint = `${props.simError.reason ?? ""}::${props.simError.short}`;
  return (
    <OrderFeedbackBody
      key={keyHint}
      simError={props.simError}
      onDismiss={props.onDismiss}
      mode={props.mode}
      autoHideMs={props.autoHideMs}
    />
  );
}
