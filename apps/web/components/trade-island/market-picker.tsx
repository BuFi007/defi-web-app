"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ALL_MARKETS,
  FX_MARKETS,
  PERP_MARKETS,
  FlagPair,
  Icon,
  fmtPct,
  type Market,
} from "./data";

type Filter = "all" | "forex" | "perp";

/**
 * Header market chip → popover with searchable/filterable market list.
 * Replaces the old "switch to MarketsTab" navigation with a one-tap dropdown.
 */
export function MarketPicker({
  market,
  setMarketSym,
}: {
  market: Market;
  setMarketSym: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;

  const source =
    filter === "forex" ? FX_MARKETS : filter === "perp" ? PERP_MARKETS : ALL_MARKETS;
  const q = query.trim().toLowerCase();
  const list = q
    ? source.filter((m) => m.sym.toLowerCase().includes(q) || m.base.toLowerCase().includes(q))
    : source;

  const choose = (sym: string) => {
    setMarketSym(sym);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="market-mini"
          aria-label={`Switch market — currently ${market.sym}`}
        >
          <FlagPair a={market.flagA} b={market.flagB} size={20} />
          <span style={{ fontWeight: 800, fontSize: 13 }}>{market.sym}</span>
          <span className="mono" style={{ fontWeight: 800, fontSize: 13 }}>
            {market.price.toFixed(dec)}
          </span>
          <span className={"pill " + (market.change >= 0 ? "profit" : "loss")}>
            {fmtPct(market.change)}
          </span>
          <Icon name="chev" size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="mp-popover p-0 w-[320px] max-w-[calc(100vw-24px)] overflow-hidden border-[var(--border)]"
      >
        <div className="mp-head">
          <div className="mp-filters">
            {(
              [
                ["all", "All", ALL_MARKETS.length],
                ["forex", "Forex", FX_MARKETS.length],
                ["perp", "Perps", PERP_MARKETS.length],
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
          <div className="mp-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets..."
              aria-label="Search markets"
            />
          </div>
        </div>
        <ul className="mp-list" role="listbox" aria-label="Markets">
          {list.length === 0 && (
            <li className="mp-empty">No markets match "{query}"</li>
          )}
          {list.map((m) => {
            const active = m.sym === market.sym;
            const d = m.price < 10 ? 4 : m.price < 1000 ? 2 : 1;
            return (
              <li key={m.sym}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"mp-row " + (active ? "active" : "")}
                  onClick={() => choose(m.sym)}
                >
                  <FlagPair a={m.flagA} b={m.flagB} size={22} />
                  <div className="mp-row-meta">
                    <span className="mp-row-sym">{m.sym}</span>
                    <span className="mp-row-type">
                      {m.type === "perp" ? `Perp · ${m.leverage}x` : `Forex · ${m.leverage}x`}
                    </span>
                  </div>
                  <span className="mp-row-price mono">{m.price.toFixed(d)}</span>
                  <span className={"pill " + (m.change >= 0 ? "profit" : "loss")}>
                    {fmtPct(m.change)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
