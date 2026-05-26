"use client";

/**
 * LoanMarketPicker — right-panel market switcher for Loan / Borrow.
 *
 * Mirrors the visual + interaction language of the header perps
 * `<MarketPicker>` (token pair icons, morphing pill → panel) but
 * sources its rows from the loan markets list and triggers a
 * loan-specific `onSelect` instead of the perps `setMarketSym`.
 *
 * Built on `<MarketPickerShell>` — the shell owns the morph, portal,
 * scrim, escape handler, and coordinate sync; this component owns
 * the loan-specific rows + APY/LLTV display.
 */

import React, { useState } from "react";

import { MarketPickerShell } from "./market-picker-shell";
import { TokenIconPair } from "./token-icon";
import type { LoanMarket } from "./loan";

export interface LoanMarketPickerProps {
  /** Currently selected market — drives the closed-pill display. */
  selected: LoanMarket | null;
  /** Full list of available markets (post live + seed merge). */
  markets: LoanMarket[];
  /** Fires when the user picks a different market from the panel. */
  onSelect: (market: LoanMarket) => void;
  /** Filter chips, defaults to all + hub split. */
  showHubFilter?: boolean;
}

function hubDisplayName(hub: string): string {
  if (hub === "arc") return "Arc";
  if (hub === "fuji") return "Fuji";
  return hub.toUpperCase();
}

export function LoanMarketPicker({
  selected,
  markets,
  onSelect,
  showHubFilter = true,
}: LoanMarketPickerProps) {
  const [filter, setFilter] = useState<"all" | "arc" | "fuji">("all");
  const [query, setQuery] = useState("");

  const filtered = markets.filter((m) => {
    if (filter !== "all" && m.hub !== filter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      m.loan.toLowerCase().includes(q) ||
      m.coll.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  });

  const counts = {
    all: markets.length,
    arc: markets.filter((m) => m.hub === "arc").length,
    fuji: markets.filter((m) => m.hub === "fuji").length,
  } as const;

  // Resting pill: compact pair icon + "LOAN/COLLATERAL" + hub pill.
  // Smaller than the perps header pill — the loan pill lives inside
  // the action card head, not its own dedicated bar, so it has to
  // read as a tight chip not a hero. Sizes set inline so the
  // phantom (which mirrors this JSX) matches the visible pill width.
  const pillInner = (sel: LoanMarket | null) =>
    sel ? (
      <>
        <TokenIconPair base={sel.loan} quote={sel.coll} size={16} />
        <span style={{ fontWeight: 800, fontSize: 12 }}>
          {sel.loan}/{sel.coll}
        </span>
        <span className="pill" style={{ fontSize: 9 }}>
          {hubDisplayName(sel.hub)}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ opacity: 0.6 }}>
          <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </>
    ) : (
      <>
        <span style={{ fontWeight: 800, fontSize: 12 }}>Pick a market</span>
      </>
    );

  return (
    <MarketPickerShell
      id="loan"
      ariaLabel={
        selected
          ? `Switch loan market — currently ${selected.loan}/${selected.coll}`
          : "Pick a loan market"
      }
      anchorClassName="lo-market-picker-anchor mkt-island-anchor"
      pillClassName="market-mini mkt-island-pill lo-market-picker-pill"
      panelAnchor="anchor-left"
      phantom={pillInner(selected)}
      trigger={() => pillInner(selected)}
      panel={({ close }) => (
        <>
          <div className="mkt-island-head">
            <div className="mkt-island-head-l">
              {selected && (
                <TokenIconPair base={selected.loan} quote={selected.coll} size={22} />
              )}
              <div className="mkt-island-head-meta">
                <span className="mkt-island-sym">
                  {selected ? `${selected.loan}/${selected.coll}` : "Loan markets"}
                </span>
                <span className="mkt-island-price mono">
                  {selected
                    ? `${hubDisplayName(selected.hub)} · ${
                        selected.lltv != null ? `${selected.lltv.toFixed(0)}% LLTV` : "—"
                      }`
                    : "Pick one to start"}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="acct-island-close"
              aria-label="Close loan market picker"
              onClick={close}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M3 3 L11 11 M11 3 L3 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="mp-head">
            {showHubFilter && (
              <div className="mp-filters">
                {(
                  [
                    ["all", "All", counts.all],
                    ["arc", "Arc", counts.arc],
                    ["fuji", "Fuji", counts.fuji],
                  ] as const
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    className={"mp-filter " + (filter === id ? "active" : "")}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                    <span className="mp-filter-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mp-search">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search loan / collateral..."
                aria-label="Search loan markets"
              />
            </div>
          </div>

          <ul className="mp-list" role="listbox" aria-label="Loan markets">
            {filtered.length === 0 && (
              <li className="mp-empty">
                {query
                  ? `No markets match "${query}"`
                  : "No markets registered on this chain yet."}
              </li>
            )}
            {filtered.map((m) => {
              const active = selected?.id === m.id;
              const supplyApy = m.yield?.compositeApy ?? m.supply;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={"mp-row " + (active ? "active" : "")}
                    onClick={() => {
                      onSelect(m);
                      close();
                    }}
                  >
                    <TokenIconPair base={m.loan} quote={m.coll} size={22} />
                    <div className="mp-row-meta">
                      <span className="mp-row-sym">
                        {m.loan}/{m.coll}
                      </span>
                      <span className="mp-row-type">
                        {hubDisplayName(m.hub)}
                        {m.lltv != null ? ` · ${m.lltv.toFixed(0)}% LLTV` : ""}
                        {supplyApy != null ? ` · ${supplyApy.toFixed(2)}% APY` : ""}
                      </span>
                    </div>
                    <span className="pill" style={{ fontSize: 9.5 }}>
                      {hubDisplayName(m.hub)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    />
  );
}
