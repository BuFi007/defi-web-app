"use client";

/**
 * Chain selector for the perp trading surface.
 *
 * Mirrors the LoanHubFilter pattern in loan.tsx (compact pill row with
 * the chain logo + short label), but scoped to perps and aware of the
 * Fuji "pending broadcast" state. The selector is the single source of
 * truth for the active perp-chain — it persists the choice in the URL
 * (`?perp_chain=<id>`) so a refresh holds, and lifts the value via the
 * `value` / `onChange` props so the parent tree (TradeIslandHeader →
 * TradeTab → ChartCard / OrderPanelCard / risk widgets) all consume the
 * same chain id.
 *
 * Wallet handling: we DO NOT auto-switch the wagmi chain when the user
 * picks a different perp chain — that's a destructive prompt (signs the
 * user out of pending workflows on the current chain). Instead, when
 * the selector's chain differs from `useChainId()`, we render a subtle
 * "Switch wallet" inline button. Clicking that explicitly calls
 * `switchChainAsync`. Same pattern the loan tab uses.
 */

import { useCallback, useMemo } from "react";
import { useChainId, useSwitchChain } from "wagmi";

import { PERPS_CHAINS, type PerpsChainId } from "@/lib/perps/chains";
import type { HubChain } from "@bufi/location/hubs";

/**
 * Inline replica of <HubPip> tuned for the chain-selector pill. Renders
 * the brand SVG on a neutral surface; falls back to the text glyph if
 * the image fails to decode. Kept local so we don't pull <LoanHub>'s
 * extra `id` / `address` fields (which only exist for the loan flow).
 */
function ChainGlyph({ hub, size }: { hub: HubChain; size: number }) {
  return (
    <span
      className="hub-pip"
      style={{
        background: "var(--surface)",
        boxShadow: `inset 0 0 0 1.5px ${hub.color}40`,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        color: hub.color,
        fontWeight: 800,
      }}
      title={hub.name}
    >
      {hub.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hub.iconUrl}
          alt={hub.name}
          width={size}
          height={size}
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span aria-hidden="true">{hub.glyph}</span>
      )}
    </span>
  );
}

interface PerpChainSelectorProps {
  value: PerpsChainId;
  onChange: (chainId: PerpsChainId) => void;
  /** Hides the wagmi mismatch sub-line. Used in mobile / arcade where vertical room is scarce. */
  compact?: boolean;
}

export function PerpChainSelector({ value, onChange, compact }: PerpChainSelectorProps) {
  const wagmiChainId = useChainId();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const mismatch = wagmiChainId !== value;
  const active = useMemo(
    () => PERPS_CHAINS.find((c) => c.chainId === value),
    [value],
  );

  const onSwitchWallet = useCallback(() => {
    if (!active) return;
    void switchChainAsync({ chainId: active.chainId }).catch(() => {
      /* User rejected. Toast is too loud here; keep silent. */
    });
  }, [active, switchChainAsync]);

  return (
    <div
      className="perp-chain-selector"
      role="group"
      aria-label="Perp trading chain"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "flex-start",
      }}
    >
      <div
        className="perp-chain-row"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 6px",
          background: "var(--surface)",
          borderRadius: 10,
          border: "1px solid var(--border)",
        }}
      >
        <span
          className="muted"
          style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, paddingLeft: 6 }}
        >
          CHAIN
        </span>
        {PERPS_CHAINS.map((c) => {
          const isActive = c.chainId === value;
          const disabled = !c.enabled;
          return (
            <button
              key={c.chainId}
              type="button"
              className={"pcs-pill" + (isActive ? " active" : "") + (disabled ? " disabled" : "")}
              onClick={() => {
                if (disabled) return;
                onChange(c.chainId);
              }}
              disabled={disabled}
              aria-pressed={isActive}
              title={c.pendingReason ?? c.hub.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                borderRadius: 8,
                fontSize: 11.5,
                fontWeight: 800,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                background: isActive ? c.hub.color + "22" : "transparent",
                color: isActive ? "var(--ink)" : "var(--ink-2)",
                boxShadow: isActive ? `inset 0 0 0 1.5px ${c.hub.color}80` : "none",
                transition: "background .15s, box-shadow .15s",
              }}
            >
              <ChainGlyph hub={c.hub} size={14} />
              <span>{c.hub.short}</span>
              {c.pending && (
                <span
                  className="pcs-pending-badge"
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "1px 5px",
                    borderRadius: 999,
                    background: "var(--warn)",
                    color: "var(--warn-ink)",
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  Live soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!compact && mismatch && active?.enabled && (
        <span
          className="muted"
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: "var(--ink-3)",
            paddingLeft: 8,
          }}
        >
          Wallet is on chain {wagmiChainId}.{" "}
          <button
            type="button"
            onClick={onSwitchWallet}
            disabled={isSwitching}
            className="link-btn"
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              color: "var(--accent-ink)",
              textDecoration: "underline",
              cursor: isSwitching ? "wait" : "pointer",
              background: "transparent",
              padding: 0,
              border: 0,
            }}
          >
            Switch to {active.hub.short}
          </button>
        </span>
      )}
    </div>
  );
}
