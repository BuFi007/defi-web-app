"use client";

import type React from "react";

export type MarketType = "forex" | "perp";

export interface Market {
  sym: string;
  base: string;
  quote: string;
  flagA: string;
  flagB: string;
  price: number;
  change: number;
  leverage: number;
  type: MarketType;
  spread: number;
  funding?: number;
}

export interface Position {
  sym: string;
  side: "long" | "short";
  size: number;
  entry: number;
  mark: number;
  pnl: number;
  margin: number;
  leverage: number;
  liq: number;
}

export interface OrderRow {
  sym: string;
  side: "long" | "short";
  type: string;
  size: number;
  price: number;
  filled: string;
  time: string;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  total: number;
}

export interface Orderbook {
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  maxTotal: number;
}

export const FX_MARKETS: Market[] = [
  { sym: "EUR/USD", base: "EUR", quote: "USD", flagA: "🇪🇺", flagB: "🇺🇸", price: 1.0842, change: 0.32, leverage: 100, type: "forex", spread: 0.00012 },
  { sym: "GBP/USD", base: "GBP", quote: "USD", flagA: "🇬🇧", flagB: "🇺🇸", price: 1.2716, change: -0.18, leverage: 100, type: "forex", spread: 0.00018 },
  { sym: "USD/JPY", base: "USD", quote: "JPY", flagA: "🇺🇸", flagB: "🇯🇵", price: 154.42, change: 0.48, leverage: 100, type: "forex", spread: 0.012 },
  { sym: "AUD/USD", base: "AUD", quote: "USD", flagA: "🇦🇺", flagB: "🇺🇸", price: 0.6648, change: -0.42, leverage: 50, type: "forex", spread: 0.00014 },
  { sym: "USD/MXN", base: "USD", quote: "MXN", flagA: "🇺🇸", flagB: "🇲🇽", price: 17.082, change: 0.92, leverage: 50, type: "forex", spread: 0.008 },
  { sym: "USD/CHF", base: "USD", quote: "CHF", flagA: "🇺🇸", flagB: "🇨🇭", price: 0.8814, change: 0.14, leverage: 100, type: "forex", spread: 0.00015 },
  { sym: "NZD/USD", base: "NZD", quote: "USD", flagA: "🇳🇿", flagB: "🇺🇸", price: 0.6034, change: -0.65, leverage: 50, type: "forex", spread: 0.00018 },
  { sym: "USD/CAD", base: "USD", quote: "CAD", flagA: "🇺🇸", flagB: "🇨🇦", price: 1.3624, change: 0.08, leverage: 100, type: "forex", spread: 0.00016 },
];

export const PERP_MARKETS: Market[] = [
  { sym: "BTC-PERP", base: "BTC", quote: "USD", flagA: "₿", flagB: "$", price: 67428.5, change: 2.18, leverage: 100, type: "perp", funding: 0.0084, spread: 0.5 },
  { sym: "ETH-PERP", base: "ETH", quote: "USD", flagA: "Ξ", flagB: "$", price: 3142.8, change: 1.42, leverage: 50, type: "perp", funding: 0.0062, spread: 0.2 },
  { sym: "SOL-PERP", base: "SOL", quote: "USD", flagA: "◎", flagB: "$", price: 156.42, change: -1.85, leverage: 50, type: "perp", funding: -0.0042, spread: 0.05 },
];

export const ALL_MARKETS: Market[] = [...FX_MARKETS, ...PERP_MARKETS];

export const MOCK_POSITIONS: Position[] = [
  { sym: "EUR/USD", side: "long", size: 50000, entry: 1.0812, mark: 1.0842, pnl: 150.0, margin: 500, leverage: 100, liq: 1.0746 },
  { sym: "USD/JPY", side: "short", size: 30000, entry: 154.92, mark: 154.42, pnl: 96.85, margin: 1850, leverage: 100, liq: 156.3 },
  { sym: "BTC-PERP", side: "long", size: 0.5, entry: 66200, mark: 67428.5, pnl: 614.25, margin: 331, leverage: 100, liq: 65540 },
  { sym: "GBP/USD", side: "long", size: 25000, entry: 1.2748, mark: 1.2716, pnl: -80.0, margin: 250, leverage: 100, liq: 1.262 },
];

export const MOCK_ORDERS: OrderRow[] = [
  { sym: "EUR/USD", side: "long", type: "Limit", size: 25000, price: 1.079, filled: "0/25000", time: "17:24:12" },
  { sym: "USD/MXN", side: "short", type: "Stop", size: 15000, price: 17.22, filled: "0/15000", time: "16:42:51" },
  { sym: "BTC-PERP", side: "long", type: "Limit", size: 0.25, price: 66500, filled: "0/0.25", time: "14:18:03" },
];

// Number formatters moved to @/utils — re-exported here so the existing
// "./data" import sites (multiplayer, arcade, panels, mobile-trade,
// market-picker, stablecoin-balances) keep working unchanged.
export { fmt, fmtUSD, fmtPct } from "@/utils";

export function makeCandles(basePrice: number, count = 120, _tickSize = 0.0001): Candle[] {
  const out: Candle[] = [];
  let p = basePrice * 0.985;
  let seed = Math.floor(basePrice * 1000);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.45) * basePrice * 0.004;
    const o = p;
    const c = p + drift;
    const h = Math.max(o, c) + rand() * basePrice * 0.003;
    const l = Math.min(o, c) - rand() * basePrice * 0.003;
    const v = rand() * 1000 + 200;
    out.push({ o, h, l, c, v });
    p = c;
  }
  const lastSpread = basePrice * 0.002;
  out[out.length - 1].c = basePrice;
  out[out.length - 1].h = Math.max(out[out.length - 1].h, basePrice + lastSpread * 0.3);
  out[out.length - 1].l = Math.min(out[out.length - 1].l, basePrice - lastSpread * 0.3);
  return out;
}

export function makeOrderbook(price: number, tickSize = 0.0001, levels = 14): Orderbook {
  let seed = Math.floor(price * 1000);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const asks: OrderbookLevel[] = [];
  const bids: OrderbookLevel[] = [];
  let askTotal = 0;
  let bidTotal = 0;
  for (let i = 0; i < levels; i++) {
    const ap = price + tickSize * (i + 1);
    const aSize = rand() * 80 + 5;
    askTotal += aSize;
    asks.push({ price: ap, size: aSize, total: askTotal });
    const bp = price - tickSize * (i + 1);
    const bSize = rand() * 80 + 5;
    bidTotal += bSize;
    bids.push({ price: bp, size: bSize, total: bidTotal });
  }
  return { asks, bids, maxTotal: Math.max(askTotal, bidTotal) };
}

export const ICONS: Record<string, string> = {
  home: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  candle: '<path d="M7 3v2M7 17v4M17 3v6M17 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="5" width="4" height="12" rx="1.2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="15" y="9" width="4" height="9" rx="1.2" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  trophy: '<path d="M8 3h8v4a4 4 0 0 1-8 0V3z M8 5H5a3 3 0 0 0 3 3 M16 5h3a3 3 0 0 1-3 3 M10 11v4h4v-4 M8 18h8v3H8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  chart: '<path d="M4 19V5 M4 19h16 M8 15l3-3 3 2 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 9V8 M12 16v-1 M15 12h1 M8 12h1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  gear: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3 M4 14a2 2 0 0 1 2-2h2v6H6a2 2 0 0 1-2-2v-2zM20 14a2 2 0 0 0-2-2h-2v6h2a2 2 0 0 0 2-2v-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10 21a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  search: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M21 21l-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  minus: '<path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  chev: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  chev_r: '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  sun: '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  sparkle: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 8v.01M12 11v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICONS[name] || "" }} />;
}

export function BufiGhost({ size = 28, color = "var(--primary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block" }}>
      <defs>
        <linearGradient id="bufi-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="1" />
          <stop offset="1" stopColor={color} stopOpacity=".75" />
        </linearGradient>
      </defs>
      <path
        d="M12 30c0-11 9-20 20-20s20 9 20 20v22c0 2-2 3-4 1.5l-3-2.5c-1-.8-2.4-.7-3.3.2l-2.7 2.7c-1.4 1.4-3.6 1.4-5 0L31.4 51c-.9-.9-2.3-.9-3.2 0l-2.6 2.6c-1.4 1.4-3.6 1.4-5 0l-2.7-2.7c-.9-.9-2.3-1-3.3-.2L11.6 53c-2 1.5-4 .5-4-1.5V30z"
        fill="url(#bufi-body)"
      />
      <ellipse cx="24" cy="28" rx="3.5" ry="5" fill="white" />
      <ellipse cx="40" cy="28" rx="3.5" ry="5" fill="white" />
      <ellipse cx="24" cy="29" rx="1.6" ry="2.2" fill="#1f1740" />
      <ellipse cx="40" cy="29" rx="1.6" ry="2.2" fill="#1f1740" />
      <ellipse cx="18" cy="36" rx="3" ry="2" fill="#ffb89a" opacity=".55" />
      <ellipse cx="46" cy="36" rx="3" ry="2" fill="#ffb89a" opacity=".55" />
      <path d="M28 38c1 1.5 3 2.4 4 2.4s3-.9 4-2.4" stroke="#1f1740" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function FlagPair({ a, b, size = 22 }: { a: string; b: string; size?: number }) {
  const flag = (txt: string) => (
    <div
      className="flag"
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.8,
        background: "var(--surface-3)",
        lineHeight: 1,
      }}
    >
      <span style={{ filter: "saturate(1.1)" }}>{txt}</span>
    </div>
  );
  return (
    <div className="market-flag-pair" style={{ width: size + 14, height: size }}>
      {flag(a)}
      {flag(b)}
    </div>
  );
}

export type { React };
