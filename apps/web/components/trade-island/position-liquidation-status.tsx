"use client";

/**
 * Composes the three per-position safety widgets:
 *
 *   1. Flag-delay countdown — visible only when the position is flagged.
 *   2. Rescind-flag CTA — visible only when flagged AND HF >= 1.
 *   3. Health-factor band tint + label.
 *
 * Mount this once per position row. The parent passes the marketId
 * (bytes32 hex) + trader address + the latest HF the parent already
 * reads off /perps/positions or the on-chain healthFactor() view.
 *
 * Display modes:
 *   - `mode="row"` — desktop table row variant (single line, dense)
 *   - `mode="card"` — mobile/card variant (multi-line, full chip)
 */

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";

import {
  classifyHealthBand,
  healthFactorFromBps,
  type PerpsHealthBand,
} from "@/lib/perps/health";
import {
  useFlagStatus,
  useHealthFactor,
  useIsLiquidatable,
} from "@/lib/perps/use-flag-status";
import { useRescindFlag } from "@/lib/perps/use-rescind-flag";

export interface PositionLiquidationStatusProps {
  marketId: Hex | undefined;
  /** Decimal HF (1.0 = boundary) — the parent already computed this. */
  hf: number | null | undefined;
  /** Display variant. */
  mode?: "row" | "card";
  /**
   * Optional trader override — defaults to the connected wallet. Useful
   * for the multiplayer / leaderboard rendering where the row may not
   * belong to the connected wallet.
   */
  traderOverride?: `0x${string}`;
}

/**
 * Client-side countdown ticker. Decouples the on-chain read (which
 * polls every 30s) from the visible "Liquidatable in 27s" string.
 * Returns the remaining seconds, or 0 once the readyAt has passed.
 */
function useSecondsUntil(readyAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (readyAt == null) return;
    const handle = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(handle);
  }, [readyAt]);
  if (readyAt == null) return null;
  return Math.max(0, readyAt - now);
}

function bandStyles(band: PerpsHealthBand): React.CSSProperties {
  switch (band) {
    case "imminent":
      return {
        background: "var(--loss-soft, #ffe5f6)",
        color: "var(--loss-ink, #b8458e)",
      };
    case "danger":
      return {
        background: "rgba(255, 140, 90, 0.18)",
        color: "#c95a26",
      };
    case "watch":
      return {
        background: "rgba(255, 210, 90, 0.20)",
        color: "#a07000",
      };
    default:
      return { background: "transparent", color: "var(--ink-3, #7c70a8)" };
  }
}

export function PositionLiquidationStatus(props: PositionLiquidationStatusProps) {
  const { marketId, hf, mode = "row", traderOverride } = props;
  const { address } = useAccount();
  const trader = traderOverride ?? (address as `0x${string}` | undefined);

  const flag = useFlagStatus({ marketId, trader });
  // Read HF on-chain when the parent doesn't supply one. The parent
  // surface (PerpsPositionsView) doesn't carry HF yet — when it does
  // (after the API surfaces it on the position DTO) the parent can
  // pass it via the `hf` prop and we'll short-circuit this read.
  const fallbackHf = useHealthFactor({
    marketId,
    trader,
    enabled: typeof hf !== "number",
  });
  const fallbackDecimalHf = healthFactorFromBps(fallbackHf.ratioBps);
  const effectiveHf =
    typeof hf === "number" ? hf : fallbackDecimalHf;

  // Only query isLiquidatable when the row is flagged — saves an RPC
  // round-trip for the common (unflagged) case.
  const { isLiquidatable } = useIsLiquidatable({
    marketId,
    trader,
    enabled: flag.isFlagged,
  });
  const rescind = useRescindFlag();

  const remaining = useSecondsUntil(flag.readyAt);
  const band = classifyHealthBand(effectiveHf);

  // Recoverable: flagged, but HF says we're back above water.
  const recovered =
    flag.isFlagged && isLiquidatable === false;

  const onRescindClick = async () => {
    if (!marketId || !trader) return;
    await rescind.rescind({ marketId, trader });
  };

  const showCountdown = flag.isFlagged && remaining !== null;
  const showRescind = flag.isFlagged && recovered;
  const showBandPill = band.band !== "none" && band.band !== "safe";

  // If nothing to render, return null so the parent row stays clean.
  if (!showCountdown && !showRescind && !showBandPill) return null;

  const containerClass =
    mode === "card" ? "pos-liq-status pos-liq-card" : "pos-liq-status pos-liq-row";

  return (
    <div
      className={containerClass}
      data-band={band.band}
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
      }}
    >
      {showBandPill && (
        <span
          className={`liq-band-pill liq-band-${band.band}${band.pulse ? " pulse" : ""}`}
          style={{
            ...bandStyles(band.band),
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.2,
            padding: "2px 7px",
            borderRadius: 6,
            textTransform: "uppercase",
            animation: band.pulse ? "liq-pulse 1.2s ease-in-out infinite" : undefined,
          }}
          aria-label={`Health factor ${band.label}`}
        >
          {band.label}
        </span>
      )}

      {showCountdown && (
        <span
          className="liq-countdown"
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color:
              remaining === 0
                ? "var(--loss-ink, #b8458e)"
                : "var(--ink-3, #7c70a8)",
            background:
              remaining === 0
                ? "var(--loss-soft, #ffe5f6)"
                : "rgba(255, 210, 90, 0.20)",
            padding: "2px 7px",
            borderRadius: 6,
            fontVariantNumeric: "tabular-nums",
          }}
          title={
            remaining === 0
              ? "The flag-delay has elapsed — keepers can call liquidate() now."
              : `Liquidation becomes possible ${remaining}s from now.`
          }
        >
          {remaining === 0
            ? "Liquidatable now"
            : `Liquidatable in ${remaining}s`}
        </span>
      )}

      {showRescind && (
        <button
          type="button"
          className="liq-rescind-btn"
          disabled={!rescind.enabled || rescind.isLoading}
          onClick={onRescindClick}
          title={
            !rescind.enabled
              ? "Available after liquidation engine v2 deploys."
              : rescind.error
                ? rescind.error
                : "Permissionless — clears the on-chain flag now that HF >= 1."
          }
          aria-label="Rescind liquidation flag"
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.2,
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid var(--loss-ink, #b8458e)",
            background: "transparent",
            color: "var(--loss-ink, #b8458e)",
            textTransform: "uppercase",
            cursor: rescind.enabled && !rescind.isLoading ? "pointer" : "not-allowed",
            opacity: rescind.enabled ? 1 : 0.55,
          }}
        >
          {rescind.isLoading ? "…" : "Rescind flag"}
        </button>
      )}

      {rescind.error && rescind.enabled && (
        <span
          className="liq-rescind-error"
          style={{
            fontSize: 10,
            color: "var(--loss-ink, #b8458e)",
            maxWidth: 200,
          }}
        >
          {rescind.error}
        </span>
      )}

      {/*
        Inline keyframes — kept here to avoid touching the global island.css
        for a single 4-line rule. The .pulse class above references this
        animation. Next.js inlines the <style> on hydration; the rule is
        scoped by name so it won't clash with other pulses in the app.
      */}
      <style>{`@keyframes liq-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(184, 69, 142, 0.4); }
        50% { box-shadow: 0 0 0 4px rgba(184, 69, 142, 0); }
      }`}</style>
    </div>
  );
}
