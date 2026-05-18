"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FlagPair, Icon, fmtPct, type Market } from "./data";
import { useMarketList } from "@/lib/perps/hooks";

type Filter = "all" | "forex" | "perp";

/**
 * Header market chip → popover with searchable/filterable market list.
 *
 * The LIST is driven by `useMarketList()`, which reads `/perps/markets`
 * (the API surface over `FxMarketRegistry.listPools()` for FX + the
 * BUFX perps registry). Decorations (flags, max leverage, type) live in
 * the hook so the chip pill keeps its visual language.
 *
 * The trigger chip (selected-market) still receives `market: Market`
 * from the parent so the live price (`useLiveMarket` ws tick) + 24h
 * change (`useMarketStats`) flow through unchanged. Per-row preview
 * prices are intentionally omitted — surfacing them honestly would
 * mean N stat fetches per popover open, and shipping a static seed
 * would be exactly the lie we're killing.
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

  const { markets, isLoading, isError } = useMarketList();

  const allLive = markets ?? [];
  const fxLive = allLive.filter((m) => m.type === "forex");
  const perpLive = allLive.filter((m) => m.type === "perp");
  const source =
    filter === "forex" ? fxLive : filter === "perp" ? perpLive : allLive;
  const q = query.trim().toLowerCase();
  const list = q
    ? source.filter(
        (m) =>
          m.sym.toLowerCase().includes(q) ||
          m.base.toLowerCase().includes(q),
      )
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
                ["all", "All", allLive.length],
                ["forex", "Forex", fxLive.length],
                ["perp", "Perps", perpLive.length],
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
          {isLoading && (
            <li className="mp-empty">Loading markets…</li>
          )}
          {isError && (
            <li className="mp-empty">
              Couldn&apos;t reach the markets API. Retry shortly.
            </li>
          )}
          {!isLoading && !isError && list.length === 0 && (
            <li className="mp-empty">
              {q ? `No markets match "${query}"` : "No markets registered on this chain yet."}
            </li>
          )}
          {list.map((m) => {
            const active = m.sym === market.sym;
            return (
              <li key={m.sym}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"mp-row " + (active ? "active" : "")}
                  onClick={() => choose(m.sym)}
                  disabled={!m.enabled}
                  title={m.enabled ? undefined : "Market is paused on-chain"}
                >
                  <FlagPair a={m.flagA} b={m.flagB} size={22} />
                  <div className="mp-row-meta">
                    <span className="mp-row-sym">{m.sym}</span>
                    <span className="mp-row-type">
                      {m.type === "perp"
                        ? `Perp · ${m.leverage}x`
                        : m.type === "forex"
                        ? `FX · ${m.leverage}x`
                        : `${m.leverage}x`}
                    </span>
                  </div>
                  {!m.enabled && (
                    <span className="pill" style={{ fontSize: 9.5 }}>
                      paused
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
