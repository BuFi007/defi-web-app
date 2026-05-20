"use client";

/**
 * Compact ticker rendering the recent AccountFlagged / AccountFlagRescinded /
 * AccountLiquidated events across all markets on the active chain.
 *
 * Mounted at the bottom of the Positions tab — placed there (rather than
 * a new island tab) because:
 *   - the positions surface is where traders watch their own risk
 *   - adding a new tab forces a re-layout of the island header
 *   - the brief allows either option
 *
 * Each row is one of:
 *   [time] EURC/USDC — trader 0xab…cd flagged by 0xef…12
 *   [time] EURC/USDC — trader 0xab…cd rescinded (auto)
 *   [time] EURC/USDC — trader 0xab…cd liquidated, reward $0.03, bad debt $0
 *
 * Data sources are scoped behind `useLiquidationEvents()` so we can swap
 * the RPC `getLogs` scaffold for Ponder GraphQL + WS push without
 * touching this file.
 */

import { useMemo } from "react";

import { truncateAddress } from "@/utils";

import { useLiquidationEvents, type LiquidationEvent } from "@/lib/perps/use-liquidation-events";
import { useMarkets } from "@/lib/perps/hooks";
import type { PerpsMarketDto } from "@/lib/perps/client";

function formatRelativeTime(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - unixSec);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function symbolForMarketId(
  marketId: string,
  markets: PerpsMarketDto[] | undefined,
): string {
  if (!markets) return marketId.slice(0, 10);
  const hit = markets.find(
    (m) => m.marketId.toLowerCase() === marketId.toLowerCase(),
  );
  return hit?.symbol ?? marketId.slice(0, 10);
}

function formatLiquidatedRewardUsd(raw: bigint | undefined): string {
  if (raw === undefined) return "$0";
  // Rewards are denominated in USDC 6dp. Convert and format.
  const usd = Number(raw) / 1_000_000;
  if (Math.abs(usd) < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatBadDebtUsd(raw: bigint | undefined): string {
  if (raw === undefined) return "$0";
  // socializedLoss is int256 in USDC 6dp. Positive value = bad debt absorbed.
  const usd = Number(raw) / 1_000_000;
  if (usd <= 0) return "$0";
  if (Math.abs(usd) < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function eventLine(ev: LiquidationEvent, symbol: string): string {
  const trader = truncateAddress(ev.trader, 4);
  const actor = truncateAddress(ev.actor, 4);
  switch (ev.kind) {
    case "flagged":
      return `${symbol} — trader ${trader} flagged by ${actor}`;
    case "rescinded": {
      const tag = ev.auto ? "(auto)" : "(manual)";
      return `${symbol} — trader ${trader} rescinded ${tag} by ${actor}`;
    }
    case "liquidated": {
      const reward = formatLiquidatedRewardUsd(ev.reward);
      const badDebt = formatBadDebtUsd(ev.socializedLoss);
      return `${symbol} — trader ${trader} liquidated, reward ${reward}, bad debt ${badDebt}`;
    }
  }
}

function dotColor(kind: LiquidationEvent["kind"]): string {
  switch (kind) {
    case "flagged":
      return "#a07000";
    case "rescinded":
      return "var(--profit-ink, #4d3fa6)";
    case "liquidated":
      return "var(--loss-ink, #b8458e)";
  }
}

export function LiquidationFeed() {
  const { events, isLoading, isError, lastUpdatedAt } = useLiquidationEvents();
  const { data: markets } = useMarkets();

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return null;
    const delta = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000));
    if (delta < 5) return "just now";
    return `${delta}s ago`;
  }, [lastUpdatedAt]);

  return (
    <section className="liq-feed" aria-label="Recent liquidation events">
      <header
        className="liq-feed-head"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 12,
        }}
      >
        <h3
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "var(--ink-3, #7c70a8)",
            margin: 0,
          }}
        >
          Liquidation activity
        </h3>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--ink-3, #7c70a8)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isError
            ? "RPC error"
            : isLoading && events.length === 0
              ? "loading…"
              : lastUpdatedLabel
                ? `updated ${lastUpdatedLabel}`
                : ""}
        </span>
      </header>

      {events.length === 0 && !isLoading && !isError && (
        <div
          className="liq-feed-empty"
          style={{
            fontSize: 11,
            color: "var(--ink-3, #7c70a8)",
            padding: "6px 0",
          }}
        >
          No liquidation activity in the last ~5,000 blocks.
        </div>
      )}

      {events.length > 0 && (
        <ul
          className="liq-feed-rows"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {events.map((ev) => {
            const symbol = symbolForMarketId(ev.marketId, markets);
            return (
              <li
                key={`${ev.txHash}-${ev.kind}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "var(--ink-2, #4a3e80)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: dotColor(ev.kind),
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "var(--ink-3, #7c70a8)", minWidth: 60 }}>
                  {formatRelativeTime(ev.timestamp)}
                </span>
                <span>{eventLine(ev, symbol)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
