"use client";

/**
 * CTA button + status surface for the /swap widget.
 *
 * Owns the "sign → submit → result" UX, but the actual hook calls live
 * in the parent so the state machine is colocated with the quote
 * lifecycle. This component only renders.
 *
 * States it surfaces (driven by the parent's status prop):
 *   - "idle"        — initial, before user enters an amount
 *   - "quoting"     — debounced quote fetch in-flight
 *   - "quoted"      — quote in hand, button enabled
 *   - "signing"     — wallet prompt visible
 *   - "submitting"  — POST /spot/fills in-flight
 *   - "success"     — fill accepted, showing fillId
 *   - "error"       — any failure surface (network, expired, rejection)
 */

import { explorerTxUrl, shortHash } from "@/lib/swap/explorer";
import type { SpotFillResponse } from "@/lib/swap/hooks";
import type { SpotPair } from "@/lib/swap/pairs";

export type SwapStatus =
  | "idle"
  | "quoting"
  | "quoted"
  | "signing"
  | "submitting"
  | "success"
  | "error";

interface SwapCtaProps {
  status: SwapStatus;
  pair: SpotPair;
  /** Disable when there's no quote, no wallet, or chain doesn't match. */
  disabled: boolean;
  /** Reason for disabled state (shown under the button). */
  disabledReason?: string;
  /** Surfaced once /spot/fills returns. */
  fill?: SpotFillResponse | null;
  /** Error message for the "error" status. */
  errorMessage?: string | null;
  onSubmit: () => void;
}

export function SwapCta({
  status,
  pair,
  disabled,
  disabledReason,
  fill,
  errorMessage,
  onSubmit,
}: SwapCtaProps) {
  // The fillId encodes a digest fragment + timestamp — Wave-K3 returns
  // it as `f_<digest12>_<hexTs>`. It is NOT a transaction hash today;
  // the actual on-chain PoolManager.swap call is gated behind
  // Wave-K1/K2 substrate (FxSwapHook deployment + venue-router
  // dispatcher). We surface it honestly as a "fill id" so the user
  // doesn't expect a snowtrace link that won't exist yet. The
  // explorerTxUrl helper exists for the moment the API starts
  // returning a real `txHash` field — wire it through then.
  const explorerHref =
    fill && fill.status === "accepted" && /^0x[a-fA-F0-9]{64}$/.test(fill.fillId)
      ? explorerTxUrl(pair.destinationChainId, fill.fillId)
      : null;

  const label = (() => {
    switch (status) {
      case "idle":
        return "Enter an amount";
      case "quoting":
        return "Fetching quote…";
      case "quoted":
        return `Swap ${pair.inputToken.asset} → ${pair.outputToken.asset}`;
      case "signing":
        return "Confirm in wallet…";
      case "submitting":
        return "Submitting fill…";
      case "success":
        return "Submitted ✓";
      case "error":
        return "Try again";
    }
  })();

  const busy = status === "signing" || status === "submitting";

  return (
    <div className="swap-cta-wrap">
      <button
        type="button"
        className={
          "swap-cta" +
          (status === "success" ? " swap-cta--success" : "") +
          (status === "error" ? " swap-cta--error" : "")
        }
        onClick={onSubmit}
        disabled={disabled || busy}
        aria-busy={busy}
      >
        {label}
      </button>

      {disabled && disabledReason && status !== "success" && (
        <p className="swap-cta-hint" role="status">
          {disabledReason}
        </p>
      )}

      {status === "error" && errorMessage && (
        <p className="swap-cta-error" role="alert">
          {errorMessage}
        </p>
      )}

      {status === "success" && fill && (
        <div className="swap-cta-success" role="status" aria-live="polite">
          <p>
            Fill <span className="mono">{shortHash(fill.fillId, 4, 6)}</span>{" "}
            {fill.status === "accepted" ? "accepted by venue router" : "rejected"}.
          </p>
          {fill.reason && <p className="swap-cta-reason">{fill.reason}</p>}
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer noopener"
              className="swap-cta-link"
            >
              View on explorer ↗
            </a>
          ) : (
            <p className="swap-cta-note">
              On-chain dispatch via PoolManager / FxSwapHook is queued — the venue
              router executes once the K1/K2 substrate lands; you&apos;ll see the tx
              hash here when it does.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
