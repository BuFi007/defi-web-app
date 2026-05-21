"use client";

/**
 * Compact 2-row grid surfacing the per-market risk parameters under the
 * chart. Reads `FxPerpClearinghouse.marketConfig` + live OI via
 * `useMarketRiskParams`. The OI capacity figure animates with
 * <AnimatedNumber> so a fresh fill visibly ticks the remaining-room
 * counter — the brief's explicit ask.
 *
 * Rendered ONLY when the active chain is enabled AND the markets list
 * yields a bytes32 marketId for the active UI symbol. If `marketConfig`
 * reverts we render a tight error stub; if only OI reverts we hide the
 * capacity tile and keep the static metadata visible.
 */

import { useMemo } from "react";

import { AnimatedNumber } from "@/components/animated-number";
import { fmtUSD } from "./data";
import { Hint } from "./hint";
import { useMarketRiskParams } from "@/lib/perps/use-market-risk-params";
import type { PerpsChainId } from "@/lib/perps/chains";
import { PERPS_CHAIN_BY_ID } from "@/lib/perps/chains";
import { useFundingRate } from "@/lib/perps/use-funding-rate";
import type { Hex } from "viem";

interface MarketRiskCardProps {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
  marketLabel: string;
}

export function MarketRiskCard({ chainId, marketId, marketLabel }: MarketRiskCardProps) {
  const risk = useMarketRiskParams({ chainId, marketId });
  const funding = useFundingRate({ chainId, marketId });
  const chain = PERPS_CHAIN_BY_ID[chainId];

  const fundingSummary = useMemo(() => {
    const data = funding.data;
    if (!data) return null;
    const direction = data.isBalanced
      ? "Balanced"
      : data.longsPay
        ? "Longs pay"
        : "Shorts pay";
    return {
      ...data,
      direction,
    };
  }, [funding.data]);

  if (!chain?.enabled) {
    return (
      <div className="card market-risk-card" aria-disabled="true">
        <div className="card-head">
          <div className="card-title">
            <span>Market risk</span>
          </div>
        </div>
        <div className="muted" style={{ padding: 12, fontSize: 11.5 }}>
          {chain?.pendingReason ?? "Perp contracts not deployed on this chain."}
        </div>
      </div>
    );
  }

  if (risk.configReadFailed) {
    return (
      <div className="card market-risk-card">
        <div className="card-head">
          <div className="card-title">
            <span>Market risk</span>
          </div>
        </div>
        <div className="muted" style={{ padding: 12, fontSize: 11.5 }}>
          Couldn&apos;t read `marketConfig` on this chain. Verify the
          clearinghouse ABI matches the deployed contract.
        </div>
      </div>
    );
  }

  const data = risk.data;

  return (
    <div className="card market-risk-card" data-chain={chain.hub.short}>
      <div
        className="card-head"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div className="card-title">
          <span>Market risk · {marketLabel}</span>
        </div>
        <span
          className="pill"
          style={{
            background: chain.hub.color + "22",
            color: chain.hub.color,
            fontSize: 10.5,
            fontWeight: 800,
          }}
        >
          {chain.hub.short}
        </span>
      </div>

      <div
        className="mrc-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
          padding: 12,
        }}
      >
        <RiskTile
          label="Max leverage"
          hint="Hard cap enforced by the clearinghouse (maxLeverageBps / 10000)."
          value={data ? `${data.maxLeverage}x` : "—"}
        />
        <RiskTile
          label="IMR / MMR"
          hint="Initial / maintenance margin requirements. IMR sets the minimum collateral to open; falling below MMR triggers liquidation."
          value={
            data
              ? `${(data.imr * 100).toFixed(1)}% / ${(data.mmr * 100).toFixed(1)}%`
              : "—"
          }
        />
        <RiskTile
          label="Trading fee"
          hint="Taker fee charged on every fill (tradingFeeBps / 10000)."
          value={data ? `${(data.tradingFee * 100).toFixed(3)}%` : "—"}
        />
        {!risk.oiReadFailed && (
          <div
            className="mrc-tile mrc-tile-wide"
            style={{
              gridColumn: "span 2",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span className="mrc-tile-l" style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 800 }}>
              OI capacity remaining{" "}
              <Hint w={280}>
                Largest side of open interest counts toward the cap.
                Capacity falls as positions are opened and recovers when
                they close. Hard cap = `maxOpenInterestUsd`.
              </Hint>
            </span>
            <span
              className="mrc-tile-v mono"
              style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2 }}
            >
              {data ? (
                <>
                  <AnimatedNumber
                    value={data.openInterestRemainingUsd}
                    currency="USD"
                    maximumFractionDigits={0}
                    notation="compact"
                  />
                  <span
                    className="muted"
                    style={{ fontSize: 10.5, marginLeft: 6, fontWeight: 700 }}
                  >
                    of {fmtUSD(data.maxOpenInterestUsd)}
                  </span>
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
        )}
        <RiskTile
          label="Funding (8h)"
          hint="Annualised funding rate, scaled to the 8-hour epoch most traders are used to. Positive = longs pay shorts."
          tone={
            !fundingSummary || fundingSummary.isBalanced
              ? "neutral"
              : fundingSummary.longsPay
                ? "profit"
                : "loss"
          }
          value={
            fundingSummary
              ? `${fundingSummary.per8hPct >= 0 ? "+" : ""}${fundingSummary.per8hPct.toFixed(4)}%`
              : funding.readFailed
                ? "n/a"
                : "—"
          }
        />
      </div>
    </div>
  );
}

function RiskTile({
  label,
  hint,
  value,
  tone = "neutral",
}: {
  label: string;
  hint: string;
  value: string;
  tone?: "neutral" | "profit" | "loss";
}) {
  const color =
    tone === "profit" ? "var(--profit-ink)" : tone === "loss" ? "var(--loss-ink)" : "var(--ink)";
  return (
    <div className="mrc-tile" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        className="mrc-tile-l"
        style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 800 }}
      >
        {label} <Hint w={260}>{hint}</Hint>
      </span>
      <span
        className="mrc-tile-v mono"
        style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2, color }}
      >
        {value}
      </span>
    </div>
  );
}
