"use client";

/**
 * Mobile-only Trade view. Rendered in place of the 3-column desktop layout
 * below the `lg` breakpoint (≤1023.98px). Pattern is borrowed from Binance /
 * Hyperliquid mobile:
 *
 *   - Chart fills the top half of the viewport (price + 24h change visible).
 *   - A 3-tab strip below the price switches the secondary panel between
 *     Chart-only / Order Book / Recent Trades.
 *   - Long / Short CTAs sit sticky at the bottom of the viewport — one tap
 *     opens the order-entry sheet pre-toggled to long or short.
 *   - The order-entry sheet (existing OrderPanelCard) slides up from the
 *     bottom as an overlay so chart visibility is preserved until the user
 *     actually wants to size a trade.
 *
 * No new deps, no animations beyond CSS transforms.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ALL_MARKETS,
  Icon,
  fmtPct,
  fmtUSD,
  type Market,
} from "./data";
import { TokenIconPair } from "./token-icon";
import { CandleChart } from "./chart";
import { TradeDrawer } from "./trade-drawer";
import { useMarkets } from "@/lib/perps/hooks";
import { useScopedI18n } from "@/locales/client";
import { usePendingIntents } from "@/lib/perps/use-pending-intents";
import type { PerpsMarketDto } from "@/lib/perps/client";

// Same heuristic as panels.tsx → resolveLiveMarket. Inlined here to keep
// mobile-trade dependency-free of the desktop panels module.
function resolvePerpMarketId(uiSym: string, markets: PerpsMarketDto[] | undefined): string | undefined {
  if (!markets || markets.length === 0) return undefined;
  const enabled = markets.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : markets;
  const base = uiSym.split(/[/-]/)[0]?.toUpperCase() ?? "";
  const baseAliases: Record<string, string[]> = {
    EUR: ["EURC"], JPY: ["JPYC", "TJPYC"], MXN: ["MXNB", "TMXNB"],
    BTC: ["CIRBTC"], AUD: ["AUDF"],
  };
  const candidates = [base, ...(baseAliases[base] ?? [])];
  for (const c of candidates) {
    const hit = pool.find((m) => m.symbol.toUpperCase().startsWith(c));
    if (hit) return hit.marketId;
  }
  return pool[0]?.marketId;
}

type InnerTab = "chart" | "book" | "trades";

interface RecentTrade {
  price: number;
  size: number;
  side: "buy" | "sell";
  time: string;
}

function makeRecentTrades(price: number, seedKey: string): RecentTrade[] {
  let seed = 0;
  for (let i = 0; i < seedKey.length; i++) seed = (seed * 31 + seedKey.charCodeAt(i)) % 233280;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const tickSize = price < 10 ? 0.0001 : price < 1000 ? 0.01 : 0.5;
  const out: RecentTrade[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const side: "buy" | "sell" = rand() > 0.5 ? "buy" : "sell";
    const drift = (rand() - 0.5) * tickSize * 6;
    const t = new Date(now.getTime() - i * 7000 - rand() * 5000);
    out.push({
      price: price + drift,
      size: rand() * 1.5 + 0.05,
      side,
      time: t.toTimeString().slice(0, 8),
    });
  }
  return out;
}

function CompactOrderbook({ market }: { market: Market }) {
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const { data: markets } = useMarkets();
  const marketId = resolvePerpMarketId(market.sym, markets);
  const { data: book, isLoading } = usePendingIntents(marketId, 10);
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const mid = book?.mid ?? market.price;
  const spread = bids.length > 0 && asks.length > 0 ? asks[0].price - bids[0].price : null;
  const spreadPct = spread != null && mid > 0 ? (spread / mid) * 100 : null;
  const maxTotal = book?.maxTotal ?? 1;
  return (
    <div className="mt-ob">
      <div className="mt-ob-cols">
        <span>Price ({market.quote})</span>
        <span>Size ({market.base})</span>
        <span>Total</span>
      </div>
      <div className="mt-ob-rows">
        <div className="ob-half ob-half-asks">
          {asks.length === 0 ? (
            <div className="ob-empty">
              <span className="ob-empty-label mono">
                {isLoading ? "loading…" : "no pending shorts"}
              </span>
            </div>
          ) : (
            asks.map((a, i) => (
              <div key={"a" + i} className="ob-row ask">
                <div className="bar" style={{ width: `${(a.total / maxTotal) * 100}%` }} />
                <span className="v price mono">{a.price.toFixed(dec)}</span>
                <span className="v size mono">{a.size.toFixed(2)}</span>
                <span className="v total mono">{a.total.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
        <div className="ob-spread">
          <span className="last mono">
            {mid.toFixed(dec)}
            <span style={{ color: market.change >= 0 ? "var(--profit-ink)" : "var(--loss-ink)" }}>
              {market.change >= 0 ? "↑" : "↓"}
            </span>
          </span>
          <span className="meta">
            {spread != null && spreadPct != null
              ? `Spread ${spread.toFixed(dec + 1)} (${spreadPct.toFixed(3)}%)`
              : `${book?.totalPending ?? 0} pending`}
          </span>
        </div>
        <div className="ob-half ob-half-bids">
          {bids.length === 0 ? (
            <div className="ob-empty">
              <span className="ob-empty-label mono">
                {isLoading ? "loading…" : "no pending longs"}
              </span>
            </div>
          ) : (
            bids.map((b, i) => (
              <div key={"b" + i} className="ob-row bid">
                <div className="bar" style={{ width: `${(b.total / maxTotal) * 100}%` }} />
                <span className="v price mono">{b.price.toFixed(dec)}</span>
                <span className="v size mono">{b.size.toFixed(2)}</span>
                <span className="v total mono">{b.total.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RecentTrades({ market }: { market: Market }) {
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const trades = useMemo(
    () => makeRecentTrades(market.price, market.sym),
    [market.sym, market.price],
  );
  return (
    <div className="mt-trades">
      <div className="mt-trades-head">
        <span>Price ({market.quote})</span>
        <span>Size ({market.base})</span>
        <span>Time</span>
      </div>
      <div className="mt-trades-rows">
        {trades.map((t, i) => (
          <div key={i} className={"mt-trade-row " + t.side}>
            <span className="mono price">{t.price.toFixed(dec)}</span>
            <span className="mono size">{t.size.toFixed(3)}</span>
            <span className="mono time">{t.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketPickerSheet({
  marketSym,
  setMarketSym,
  onClose,
}: {
  marketSym: string;
  setMarketSym: (s: string) => void;
  onClose: () => void;
}) {
  const t = useScopedI18n('MobileTrade');
  const [tab, setTab] = useState<"all" | "forex" | "perp">("all");
  const list = ALL_MARKETS.filter((m) => tab === "all" || m.type === tab);
  return (
    <div className="mt-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="mt-sheet mt-sheet-market"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Select market"
      >
        <div className="mt-sheet-head">
          <span className="mt-sheet-handle" />
          <div className="mt-sheet-title">Select market</div>
          <button className="mt-sheet-close" onClick={onClose} aria-label="Close">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="mt-mkt-tabs">
          {(["all", "forex", "perp"] as const).map((k) => (
            <button
              key={k}
              className={"mt-mkt-tab " + (tab === k ? "active" : "")}
              onClick={() => setTab(k)}
            >
              {k === "all" ? t("all") : k === "forex" ? t("forex") : t("perps")}
            </button>
          ))}
        </div>
        <div className="mt-mkt-list">
          {list.map((m) => {
            const dec = m.price < 10 ? 4 : m.price < 1000 ? 2 : 1;
            const active = marketSym === m.sym;
            return (
              <button
                key={m.sym}
                className={"mt-mkt-row " + (active ? "active" : "")}
                onClick={() => {
                  setMarketSym(m.sym);
                  onClose();
                }}
              >
                <TokenIconPair base={m.base} quote={m.quote} size={22} />
                <div className="mt-mkt-meta">
                  <div className="mt-mkt-sym">{m.sym}</div>
                  <div className="mt-mkt-type">
                    {m.type === "perp" ? t("perpetual") : t("forex")} · {m.leverage}x
                  </div>
                </div>
                <div className="mt-mkt-price">
                  <span className="mono">{m.price.toFixed(dec)}</span>
                  <span
                    className={"mt-mkt-chg " + (m.change >= 0 ? "profit" : "loss")}
                  >
                    {fmtPct(m.change)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Legacy OrderSheet replaced by TradeDrawer — the multi-step Dynamic
// Island flow. See trade-drawer.tsx.

export function MobileTrade({
  market,
  marketSym,
  setMarketSym,
}: {
  market: Market;
  marketSym: string;
  setMarketSym: (s: string) => void;
}) {
  const t = useScopedI18n('MobileTrade');
  const [inner, setInner] = useState<InnerTab>("chart");
  const [tf, setTf] = useState("15m");
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [orderSide, setOrderSide] = useState<"long" | "short" | null>(null);
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const tfs = ["1m", "5m", "15m", "1H", "4H", "1D"];

  // Lock background scroll while any sheet is open.
  useEffect(() => {
    const open = showMarketPicker || orderSide !== null;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showMarketPicker, orderSide]);

  return (
    <div className="mobile-trade">
      {/* Price header — one tap to switch market. Compacted to a single row
         on phone: [flag][sym/lev][price][chg]. 24h H/L/Vol moved into a thin
         secondary mono row to free vertical real estate for the chart. */}
      <button
        className="mt-price-bar"
        onClick={() => setShowMarketPicker(true)}
        aria-label={`Switch market. Currently ${market.sym}`}
      >
        <TokenIconPair base={market.base} quote={market.quote} size={24} />
        <div className="mt-price-sym">
          <span>{market.sym}</span>
          <span className="pill primary">{market.leverage}x</span>
          <Icon name="chev" size={10} />
        </div>
        <span className="mt-price-v mono">{market.price.toFixed(dec)}</span>
        <span
          className={"mt-price-chg mono " + (market.change >= 0 ? "profit" : "loss")}
        >
          {fmtPct(market.change)}
        </span>
        <div className="mt-price-stats">
          <span><em>H</em><span className="mono">{(market.price * 1.012).toFixed(dec)}</span></span>
          <span><em>L</em><span className="mono">{(market.price * 0.988).toFixed(dec)}</span></span>
          <span><em>Vol</em><span className="mono">{market.type === "perp" ? "$2.8B" : "$1.4B"}</span></span>
        </div>
      </button>

      {/* Inner tabs (Binance pattern) */}
      <div className="mt-inner-tabs">
        {(
          [
            { id: "chart", label: t("chart") },
            { id: "book", label: t("orderBook") },
            { id: "trades", label: t("trades") },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            className={"mt-inner-tab " + (inner === tab.id ? "active" : "")}
            onClick={() => setInner(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {inner === "chart" && (
        <div className="mt-tf-row">
          {tfs.map((tfv) => (
            <button
              key={tfv}
              className={"tf-btn " + (tf === tfv ? "active" : "")}
              onClick={() => setTf(tfv)}
            >
              {tfv}
            </button>
          ))}
        </div>
      )}

      <div className="mt-body">
        {inner === "chart" && (
          <div className="mt-chart-wrap">
            <CandleChart market={market} timeframe={tf} />
          </div>
        )}
        {inner === "book" && <CompactOrderbook market={market} />}
        {inner === "trades" && <RecentTrades market={market} />}
      </div>

      {/* Sticky CTA — reach test: ≤1 thumb-tap from chart. Labels stay
         Buy/Sell because the mobile drawer defaults to Spot mode; the
         trader switches to perps inside the drawer via the leverage
         slider, where the Long/Short language takes over. */}
      <div className="mt-cta-bar">
        <div className="mt-cta-avail">
          <span className="mt-pl">{t("trade")}</span>
          <span className="mono">{market.sym}</span>
        </div>
        <div className="mt-cta-row">
          <button className="mt-cta long" onClick={() => setOrderSide("long")}>
            <Icon name="sparkle" size={14} />
            {t("buy")}
          </button>
          <button className="mt-cta short" onClick={() => setOrderSide("short")}>
            <Icon name="sparkle" size={14} />
            {t("sell")}
          </button>
        </div>
      </div>

      {showMarketPicker && (
        <MarketPickerSheet
          marketSym={marketSym}
          setMarketSym={setMarketSym}
          onClose={() => setShowMarketPicker(false)}
        />
      )}
      {orderSide !== null && (
        <TradeDrawer
          market={market}
          initialSide={orderSide}
          onClose={() => setOrderSide(null)}
        />
      )}
    </div>
  );
}
