"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon, fmtPct, type Market } from "./data";
import { TokenIconPair } from "./token-icon";
import { useMultiHubMarketList } from "@/lib/perps/hooks";

// 43113 → Fuji, 5042002 → Arc. Anything else falls back to the raw id so
// a new hub doesn't render a blank chip.
function hubLabel(chainId: number): string {
  if (chainId === 5042002) return "Arc";
  if (chainId === 43113) return "Fuji";
  return `chain ${chainId}`;
}

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

  const { markets, isLoading, isError } = useMultiHubMarketList();

  const allLive = markets ?? [];
  // Filter pills count by the (normalized) uiSymbol's type so the
  // numbers reflect the catalogue the user actually sees.
  const fxLive = allLive.filter((m) => m.type === "forex");
  const perpLive = allLive.filter((m) => m.type === "perp");
  const source =
    filter === "forex" ? fxLive : filter === "perp" ? perpLive : allLive;
  const q = query.trim().toLowerCase();
  const list = q
    ? source.filter(
        (m) =>
          m.uiSymbol.toLowerCase().includes(q) ||
          m.apiSymbol.toLowerCase().includes(q) ||
          m.base.toLowerCase().includes(q),
      )
    : source;

  const choose = (uiSymbol: string) => {
    // Always hand the parent the canonical UI symbol so ALL_MARKETS.find
    // resolves + the Pyth Benchmarks lookup keys correctly. The raw
    // apiSymbol stays on the MarketListEntry for order routing.
    setMarketSym(uiSymbol);
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
          <TokenIconPair base={market.base} quote={market.quote} size={20} />
          <span style={{ fontWeight: 800, fontSize: 13 }}>{market.sym}</span>
          <span className="mono" style={{ fontWeight: 800, fontSize: 13 }}>
            {/* Em-dash while Pyth Hermes WS hasn't ticked + Benchmarks
                stats haven't returned. Previously the trigger rendered
                "0.0000" which looked like a real (broken) quote. */}
            {market.price > 0 ? market.price.toFixed(dec) : "—"}
          </span>
          {market.price > 0 && (
            <span className={"pill " + (market.change >= 0 ? "profit" : "loss")}>
              {fmtPct(market.change)}
            </span>
          )}
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
            const active = m.uiSymbol === market.sym;
            return (
              // Use marketId for the React key — uiSymbol can collide
              // when the same FX pair is registered on multiple hubs.
              <li key={m.marketId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"mp-row " + (active ? "active" : "")}
                  onClick={() => choose(m.uiSymbol)}
                  disabled={!m.enabled}
                  title={m.enabled ? undefined : "Market is paused on-chain"}
                >
                  <TokenIconPair base={m.base} quote={m.quote} size={22} />
                  <div className="mp-row-meta">
                    <span className="mp-row-sym">{m.uiSymbol}</span>
                    <span className="mp-row-type">
                      {m.type === "perp"
                        ? `Perp · ${m.leverage}x`
                        : m.type === "forex"
                        ? `FX · ${m.leverage}x`
                        : `${m.leverage}x`}
                    </span>
                  </div>
                  <span className="pill" style={{ fontSize: 9.5 }}>
                    {hubLabel(m.chainId)}
                  </span>
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
