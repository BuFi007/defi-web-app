"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon, fmtPct, type Market } from "./data";
import { TokenIconPair } from "./token-icon";
import { AnimatedNumber } from "@/components/animated-number";
import { useMultiHubMarketList } from "@/lib/perps/hooks";
import { hubLabel } from "@bufi/location/hubs";

type Filter = "all" | "forex" | "perp";

/**
 * Header market chip — Dynamic Island morph.
 *
 * Resting state is intentionally compact (icons + symbol only); on
 * hover/focus the price + change pill expand inline. Clicking the chip
 * morphs the pill into a searchable/filterable market picker panel,
 * portaled to body (escapes the island's `overflow: hidden`) and sharing
 * `layoutId="mkt-island"` with the pill so framer-motion animates the
 * geometry between them.
 *
 * Data: `useMultiHubMarketList()` reads `/perps/markets` (FxMarketRegistry
 * for FX + BUFX perps). The trigger keeps the live `Market` prop so the
 * Pyth Hermes WS tick + Benchmarks stats keep flowing through unchanged.
 */
export function MarketPicker({
  market,
  setMarketSym,
}: {
  market: Market;
  setMarketSym: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const expanded = hover && !open;
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const priceReady = market.price > 0;

  const { markets, isLoading, isError } = useMultiHubMarketList();

  const allLive = markets ?? [];
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
    setMarketSym(uiSymbol);
    setOpen(false);
    setQuery("");
  };

  // Track anchor bbox so the portaled panel docks to the trigger's spot.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const el = anchorRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setCoords({ top: r.top, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Match the wallet's Emil-style spring so the two islands feel like
  // siblings in the same UI language.
  const SPRING = { type: "spring", stiffness: 260, damping: 36, mass: 0.7 } as const;

  return (
    <>
      <div ref={anchorRef} className="mkt-island-anchor">
        {/* Phantom holds the slot at the EXPANDED width so adjacent
            header items don't shift when the pill collapses on idle.
            Always mirrors the full content. */}
        <span className="market-mini market-mini--phantom" aria-hidden="true">
          <TokenIconPair base={market.base} quote={market.quote} size={20} />
          <span style={{ fontWeight: 800, fontSize: 13 }}>{market.sym}</span>
          <span className="mono" style={{ fontWeight: 800, fontSize: 13 }}>
            {priceReady ? market.price.toFixed(dec) : "—"}
          </span>
          {priceReady && (
            <span className={"pill " + (market.change >= 0 ? "profit" : "loss")}>
              {fmtPct(market.change)}
            </span>
          )}
          <Icon name="chev" size={11} />
        </span>

        <AnimatePresence initial={false}>
          {!open && (
            <motion.button
              key="pill"
              type="button"
              layoutId="mkt-island"
              className="market-mini mkt-island-pill"
              aria-label={`Switch market — currently ${market.sym}`}
              aria-expanded={false}
              onClick={() => setOpen(true)}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onFocus={() => setHover(true)}
              onBlur={() => setHover(false)}
              transition={SPRING}
              style={{ borderRadius: 12 }}
            >
              <TokenIconPair base={market.base} quote={market.quote} size={20} />
              <span style={{ fontWeight: 800, fontSize: 13 }}>{market.sym}</span>
              <AnimatePresence initial={false}>
                {expanded && priceReady && (
                  <motion.span
                    key="price"
                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                    animate={{ opacity: 1, width: "auto", marginLeft: 0 }}
                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                    transition={{ duration: 0.18 }}
                    className="mono"
                    style={{
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    {market.price.toFixed(dec)}
                  </motion.span>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {expanded && priceReady && (
                  <motion.span
                    key="pct"
                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                    animate={{ opacity: 1, width: "auto", marginLeft: 0 }}
                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                    transition={{ duration: 0.18 }}
                    className={"pill " + (market.change >= 0 ? "profit" : "loss")}
                    style={{ overflow: "hidden", whiteSpace: "nowrap" }}
                  >
                    {fmtPct(market.change)}
                  </motion.span>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.span
                    key="chev"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 0.7, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: "inline-flex", overflow: "hidden" }}
                  >
                    <Icon name="chev" size={11} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {mounted &&
        createPortal(
          <AnimatePresence initial={false}>
            {open && (
              <React.Fragment key="open">
                <motion.button
                  key="scrim"
                  type="button"
                  className="acct-island-scrim"
                  aria-label="Close market picker"
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
                <motion.div
                  key="panel"
                  layoutId="mkt-island"
                  className="mkt-island-panel"
                  role="dialog"
                  aria-label="Market picker"
                  aria-modal="false"
                  transition={SPRING}
                  style={{
                    position: "fixed",
                    top: coords?.top ?? 0,
                    left: coords?.left ?? 16,
                    borderRadius: 18,
                  }}
                >
                  <motion.div
                    className="mkt-island-inner"
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{
                      duration: 0.26,
                      delay: 0.10,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <div className="mkt-island-head">
                      <div className="mkt-island-head-l">
                        <TokenIconPair base={market.base} quote={market.quote} size={22} />
                        <div className="mkt-island-head-meta">
                          <span className="mkt-island-sym">{market.sym}</span>
                          <span className="mkt-island-price mono">
                            {priceReady ? (
                              <AnimatedNumber
                                value={market.price}
                                currency={null}
                                maximumFractionDigits={dec}
                                minimumFractionDigits={dec}
                              />
                            ) : (
                              "—"
                            )}
                            {priceReady && (
                              <span className={"pill ml-1 " + (market.change >= 0 ? "profit" : "loss")}>
                                {fmtPct(market.change)}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="acct-island-close"
                        aria-label="Close market picker"
                        onClick={() => setOpen(false)}
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
                      {isLoading && <li className="mp-empty">Loading markets…</li>}
                      {isError && (
                        <li className="mp-empty">
                          Couldn&apos;t reach the markets API. Retry shortly.
                        </li>
                      )}
                      {!isLoading && !isError && list.length === 0 && (
                        <li className="mp-empty">
                          {q
                            ? `No markets match "${query}"`
                            : "No markets registered on this chain yet."}
                        </li>
                      )}
                      {list.map((m) => {
                        const active = m.uiSymbol === market.sym;
                        return (
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
                  </motion.div>
                </motion.div>
              </React.Fragment>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
