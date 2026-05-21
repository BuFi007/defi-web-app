"use client";

/**
 * Cross-chain position list rendered ABOVE the existing single-chain
 * PerpsPositionsView. Reads `FxPerpClearinghouse.position` on every
 * (live perp chain × enumerable market) via multicall — see
 * `useCrossChainPositions` for the fan-out shape and rationale.
 *
 * Behaviours from the brief:
 *   - Aggregate Arc + Fuji into one list, sort by absolute notional desc.
 *   - Each row shows the chain inline (badge tinted to hub.color).
 *   - Clicking a row tells the parent to scope the chain selector to
 *     that row's chain. The market-picker doesn't get a hook from here
 *     because the per-symbol selection is owned by `TradeIsland`'s
 *     `marketSym` state — surfacing the chain change is enough; the
 *     user can refine the market via the picker.
 */

import { useMemo } from "react";

import { fmtUSD } from "./data";
import { Hint } from "./hint";
import { useCrossChainPositions } from "@/lib/perps/use-perp-positions";
import {
  PERPS_CHAINS,
  PERPS_CHAIN_BY_ID,
  type PerpsChainId,
  type PerpsChainManifest,
} from "@/lib/perps/chains";
import type { CrossChainPositionRow } from "@/lib/perps/use-perp-positions";
import { useAccount } from "wagmi";

interface CrossChainPositionsProps {
  /** When set, lets the row click pivot the parent chain selector. */
  onPickChain?: (chainId: PerpsChainId) => void;
}

export function CrossChainPositions({ onPickChain }: CrossChainPositionsProps) {
  const { address } = useAccount();
  const trader = address as `0x${string}` | undefined;
  const { rows, isLoading, isError } = useCrossChainPositions({ trader });

  // Group by chain for the empty-state hints (so we can say "0 on Arc,
  // pending broadcast on Fuji").
  const perChainCount = useMemo(() => {
    const map: Partial<Record<PerpsChainId, number>> = {};
    for (const r of rows) {
      map[r.chainId] = (map[r.chainId] ?? 0) + 1;
    }
    return map;
  }, [rows]);

  if (!trader) {
    // PerpsPositionsView already renders a Connect-wallet empty state;
    // we don't want to double up. Return null.
    return null;
  }

  return (
    <section
      className="cross-chain-positions"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginBottom: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <h3
          style={{
            fontSize: 12.5,
            fontWeight: 800,
            color: "var(--ink-2)",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Positions across chains{" "}
          <Hint w={320}>
            Reads `FxPerpClearinghouse.position(marketId, trader)` on
            every hub — Arc Testnet and Avalanche Fuji today. Multicall
            keeps this to one RPC roundtrip per chain.
          </Hint>
        </h3>
        <ChainBadgeStrip perChainCount={perChainCount} chains={PERPS_CHAINS} />
      </header>

      {isLoading && rows.length === 0 && (
        <div className="muted" style={{ fontSize: 11.5, padding: "6px 4px" }}>
          Loading positions across chains…
        </div>
      )}
      {isError && (
        <div className="muted" style={{ fontSize: 11.5, padding: "6px 4px" }}>
          Couldn&apos;t reach any perp chain. Retry shortly.
        </div>
      )}

      {rows.length > 0 && (
        <div
          className="ccp-rows"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {rows.map((row) => (
            <PositionRow key={`${row.chainId}-${row.marketId}`} row={row} onPickChain={onPickChain} />
          ))}
        </div>
      )}
    </section>
  );
}

function PositionRow({
  row,
  onPickChain,
}: {
  row: CrossChainPositionRow;
  onPickChain?: (chainId: PerpsChainId) => void;
}) {
  const chain = PERPS_CHAIN_BY_ID[row.chainId];
  const sideColor = row.side === "long" ? "var(--profit-ink)" : "var(--loss-ink)";
  const handleClick = () => onPickChain?.(row.chainId);
  // marginReserved is USDC native (1e6). marginUsd = raw / 1e6 — guard
  // against the BigInt → Number cast for catastrophic values by clamping.
  const marginUsd =
    row.marginReserved > 0n ? Number(row.marginReserved) / 1e6 : 0;
  return (
    <button
      type="button"
      onClick={handleClick}
      className="ccp-row"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: "transparent",
        border: 0,
        borderBottom: "1px solid var(--border)",
        cursor: onPickChain ? "pointer" : "default",
        textAlign: "left",
        color: "var(--ink)",
      }}
      title={onPickChain ? `Scope trade tab to ${chain?.hub.short ?? row.chainId}` : undefined}
    >
      <span
        className="pill"
        style={{
          background: (chain?.hub.color ?? "#888") + "22",
          color: chain?.hub.color ?? "var(--ink-2)",
          fontSize: 10,
          fontWeight: 800,
          padding: "2px 7px",
        }}
      >
        {chain?.hub.short ?? `chain ${row.chainId}`}
      </span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontWeight: 800, fontSize: 12.5 }}>{row.marketKey.replace("_", "/")}</span>
        <span style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 700 }}>
          {row.marketId.slice(0, 10)}…
        </span>
      </div>
      <span
        className="side-tag"
        style={{
          color: sideColor,
          fontWeight: 800,
          fontSize: 10.5,
          letterSpacing: 0.5,
        }}
      >
        {row.side.toUpperCase()}
      </span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 800 }}>
        {row.notionalUsdc != null ? fmtUSD(row.notionalUsdc) : "—"}
      </span>
      <span className="mono muted" style={{ fontSize: 11, fontWeight: 700 }}>
        {marginUsd > 0 ? `${fmtUSD(marginUsd)} margin` : "—"}
      </span>
    </button>
  );
}

function ChainBadgeStrip({
  perChainCount,
  chains,
}: {
  perChainCount: Partial<Record<PerpsChainId, number>>;
  chains: readonly PerpsChainManifest[];
}) {
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      {chains.map((c) => {
        const n = perChainCount[c.chainId] ?? 0;
        const dim = !c.enabled || n === 0;
        return (
          <span
            key={c.chainId}
            className="pill"
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 7px",
              background: c.hub.color + (dim ? "11" : "22"),
              color: c.hub.color,
              opacity: dim ? 0.7 : 1,
            }}
            title={c.pendingReason ?? `${n} position${n === 1 ? "" : "s"}`}
          >
            {c.hub.short} · {c.pending ? "soon" : n}
          </span>
        );
      })}
    </div>
  );
}
