"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ALL_MARKETS,
  FX_MARKETS,
  PERP_MARKETS,
  MOCK_POSITIONS,
  MOCK_ORDERS,
  FlagPair,
  Icon,
  fmtPct,
  fmtUSD,
  type Market,
} from "./data";
import { Hint } from "./hint";
import { OrderbookCard, OrderPanelCard, ChartCard } from "./panels";
import {
  LoanTab,
  LOAN_POSITIONS,
  LOAN_MARKETS,
  LOAN_TOKENS,
  LOAN_HUBS,
} from "./loan";
import { ArcadeRoom } from "./multiplayer";
import { MobileTrade } from "./mobile-trade";
import { MarketPicker } from "./market-picker";

// Tiny media-query hook so the Trade tab can branch to the mobile layout
// without bringing in a dependency. Server render returns false; client
// hydrates with the actual match and subscribes to changes.
function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatch(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [query]);
  return match;
}

const TAB_HINTS: Record<string, string> = {
  loan: "Lend and borrow FX stablecoins across hubs. Earn yield or take a collateralized loan.",
  trade: "Order book trading with leverage. Live charts, limit/market orders, manage positions.",
  positions: "See your open positions, unrealized PnL, and adjust take-profit / stop-loss.",
  leaders: "Top traders by PnL and ROI. Tap Copy to mirror their trades automatically.",
  history: "A timeline of every trade you've closed. Filterable, exportable.",
};

interface TabDef {
  id: string;
  label: string;
  icon: string;
  count?: number;
}

const TABS: TabDef[] = [
  { id: "loan", label: "Loan / Borrow", icon: "vault" },
  { id: "trade", label: "Trade", icon: "candle" },
  { id: "positions", label: "Positions", icon: "layers", count: MOCK_POSITIONS.length },
  { id: "leaders", label: "Leaderboard", icon: "trophy" },
  { id: "history", label: "History", icon: "doc" },
];


function LeadersTab() {
  const leaders = [
    { rank: 1, name: "kawaii_whale", avatar: "🐳", pnl: 84210, roi: 142.8, trades: 218, winrate: 68, copy: 1820 },
    { rank: 2, name: "zen_trader_42", avatar: "🌸", pnl: 51820, roi: 96.2, trades: 412, winrate: 71, copy: 1450 },
    { rank: 3, name: "moonshot_fox", avatar: "🦊", pnl: 38940, roi: 88.4, trades: 184, winrate: 64, copy: 982 },
    { rank: 4, name: "sakura_yen", avatar: "🍡", pnl: 31420, roi: 72.1, trades: 326, winrate: 69, copy: 740 },
    { rank: 5, name: "mint_arbitrage", avatar: "🍵", pnl: 24180, roi: 48.6, trades: 1240, winrate: 78, copy: 1184 },
    { rank: 6, name: "lavender_ghost", avatar: "👻", pnl: 18620, roi: 41.2, trades: 286, winrate: 62, copy: 462 },
  ];
  return (
    <div className="leaders-tab">
      <div className="leaders-period">
        {["24h", "7d", "30d", "All-time"].map((p, i) => (
          <button
            key={p}
            className={"period-btn " + (i === 2 ? "active" : "")}
            title={`Rankings over the last ${p}`}
          >
            {p}
          </button>
        ))}
      </div>
      <table className="table leaders-table table-desktop-only">
        <thead>
          <tr>
            <th>
              Rank <Hint w={180}>Position based on selected period&apos;s profit.</Hint>
            </th>
            <th>Trader</th>
            <th>
              30d PnL <Hint w={220}>Net profit and loss across all closed trades in the period.</Hint>
            </th>
            <th>
              ROI <Hint w={220}>Return on initial deposit. Higher = better.</Hint>
            </th>
            <th>
              Trades <Hint w={200}>Number of trades opened and closed in this period.</Hint>
            </th>
            <th>
              Win rate <Hint w={220}>Share of trades that closed in profit.</Hint>
            </th>
            <th>
              Followers <Hint w={240}>People copy-trading this trader right now.</Hint>
            </th>
            <th>
              Action{" "}
              <Hint w={260} side="left">
                Tap Copy to mirror this trader&apos;s next moves automatically.
              </Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((l) => (
            <tr key={l.name}>
              <td>
                <span className={"rank-badge rank-" + (l.rank <= 3 ? l.rank : "n")}>{l.rank}</span>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: "var(--surface-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    {l.avatar}
                  </div>
                  <span style={{ fontWeight: 800 }}>@{l.name}</span>
                </div>
              </td>
              <td className="mono" style={{ color: "var(--profit-ink)", fontWeight: 800 }}>
                +{fmtUSD(l.pnl)}
              </td>
              <td className="mono" style={{ color: "var(--profit-ink)" }}>
                +{l.roi.toFixed(1)}%
              </td>
              <td className="mono">{l.trades}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="mono" style={{ fontWeight: 800 }}>
                    {l.winrate}%
                  </span>
                  <div style={{ width: 50, height: 4, borderRadius: 999, background: "var(--surface-3)" }}>
                    <div
                      style={{
                        width: `${l.winrate}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "var(--profit)",
                      }}
                    />
                  </div>
                </div>
              </td>
              <td className="mono">{l.copy.toLocaleString()}</td>
              <td>
                <button className="copy-btn">
                  <Icon name="copy" size={11} /> Copy
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="leader-cards" aria-label="Top traders">
        {leaders.map((l) => (
          <article key={l.name} className="leader-card">
            <span className={"rank-badge rank-" + (l.rank <= 3 ? l.rank : "n")}>{l.rank}</span>
            <div className="leader-avatar" aria-hidden="true">{l.avatar}</div>
            <div className="leader-card-meta">
              <div className="leader-card-name">@{l.name}</div>
              <div className="leader-card-sub">
                <span className="mono">{l.winrate}% win</span>
                <span className="mono">{l.trades} trades</span>
                <span className="mono">{l.copy.toLocaleString()} ☆</span>
              </div>
            </div>
            <div className="leader-card-pnl">
              <span className="leader-card-pnl-v mono">+{fmtUSD(l.pnl)}</span>
              <span className="leader-card-pnl-l">30d PnL</span>
            </div>
            <button className="copy-btn">
              <Icon name="copy" size={12} /> Copy @{l.name}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function HistoryTab() {
  const trades = [
    { time: "15:42:18", sym: "EUR/USD", side: "long" as const, size: 25000, entry: 1.0812, exit: 1.0848, pnl: 90.0, fee: 1.25 },
    { time: "14:08:32", sym: "BTC-PERP", side: "short" as const, size: 0.25, entry: 67890, exit: 67420, pnl: 117.5, fee: 8.42 },
    { time: "11:22:48", sym: "USD/JPY", side: "long" as const, size: 30000, entry: 153.84, exit: 154.42, pnl: 173.4, fee: 1.85 },
    { time: "10:14:02", sym: "GBP/USD", side: "long" as const, size: 40000, entry: 1.2742, exit: 1.2698, pnl: -176.0, fee: 2.0 },
    { time: "08:42:18", sym: "SOL-PERP", side: "short" as const, size: 18, entry: 158.2, exit: 156.42, pnl: 32.04, fee: 1.42 },
    { time: "07:18:42", sym: "AUD/USD", side: "short" as const, size: 22000, entry: 0.6684, exit: 0.6648, pnl: 79.2, fee: 1.1 },
  ];
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const [showMoreStats, setShowMoreStats] = useState(false);
  return (
    <div className="history-tab">
      <div className="history-summary">
        <div className="hsum-card">
          <div className="hsum-l">
            Today&apos;s PnL <Hint w={220}>Net profit and loss across every trade closed today.</Hint>
          </div>
          <div className={"hsum-v mono " + (totalPnl >= 0 ? "profit" : "loss")}>
            {totalPnl >= 0 ? "+" : ""}
            {fmtUSD(totalPnl)}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Trades <Hint w={200}>How many trades you closed today.</Hint>
          </div>
          <div className="hsum-v mono">{trades.length}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Win rate <Hint w={220}>Percent of today&apos;s trades that closed in profit.</Hint>
          </div>
          <div className="hsum-v mono">{Math.round((wins / trades.length) * 100)}%</div>
        </div>
        <div className={"hsum-card hsum-more" + (showMoreStats ? " open" : "")}>
          <div className="hsum-l">
            Avg. Hold <Hint w={220}>Average time between opening and closing a trade today.</Hint>
          </div>
          <div className="hsum-v mono">2h 14m</div>
        </div>
        <div className={"hsum-card hsum-more" + (showMoreStats ? " open" : "")}>
          <div className="hsum-l">
            Fees Paid <Hint w={220}>Total trading and funding fees paid today.</Hint>
          </div>
          <div className="hsum-v mono">{fmtUSD(trades.reduce((s, t) => s + t.fee, 0))}</div>
        </div>
      </div>
      <button
        type="button"
        className="hsum-toggle"
        onClick={() => setShowMoreStats((v) => !v)}
        aria-expanded={showMoreStats}
      >
        {showMoreStats ? "Hide" : "Show"} avg hold + fees
      </button>
      <table className="table table-desktop-only">
        <thead>
          <tr>
            <th>Time</th>
            <th>Market</th>
            <th>
              Side <Hint w={220}>Long bets the price rises. Short bets it falls.</Hint>
            </th>
            <th>
              Size <Hint w={220}>Notional value of the trade in the base currency.</Hint>
            </th>
            <th>
              Entry <Hint w={200}>Price at which the trade was opened.</Hint>
            </th>
            <th>
              Exit <Hint w={200}>Price at which the trade was closed.</Hint>
            </th>
            <th>
              Fee <Hint w={200}>Trading fee paid when this trade closed.</Hint>
            </th>
            <th>
              PnL{" "}
              <Hint w={220} side="left">
                Profit or loss after fees.
              </Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const m = ALL_MARKETS.find((mm) => mm.sym === t.sym);
            const dec = t.entry < 10 ? 4 : t.entry < 1000 ? 2 : 1;
            return (
              <tr key={i}>
                <td className="mono" style={{ color: "var(--ink-3)" }}>
                  {t.time}
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <FlagPair a={m?.flagA || "◎"} b={m?.flagB || "$"} size={20} />
                    <span style={{ fontWeight: 800 }}>{t.sym}</span>
                  </div>
                </td>
                <td>
                  <span className={"side-tag " + t.side}>{t.side.toUpperCase()}</span>
                </td>
                <td className="mono">{t.size.toLocaleString()}</td>
                <td className="mono">{t.entry.toFixed(dec)}</td>
                <td className="mono">{t.exit.toFixed(dec)}</td>
                <td className="mono" style={{ color: "var(--ink-3)" }}>
                  {fmtUSD(t.fee)}
                </td>
                <td
                  className="mono"
                  style={{ color: t.pnl >= 0 ? "var(--profit-ink)" : "var(--loss-ink)", fontWeight: 800 }}
                >
                  {t.pnl >= 0 ? "+" : ""}
                  {fmtUSD(t.pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hist-cards" aria-label="Closed trades today">
        {trades.map((t, i) => {
          const m = ALL_MARKETS.find((mm) => mm.sym === t.sym);
          const dec = t.entry < 10 ? 4 : t.entry < 1000 ? 2 : 1;
          return (
            <article key={i} className="hist-card">
              <header className="hist-card-head">
                <FlagPair a={m?.flagA || "◎"} b={m?.flagB || "$"} size={22} />
                <div className="hist-card-meta">
                  <div className="hist-card-sym">
                    {t.sym}{" "}
                    <span className={"side-tag " + t.side} style={{ marginLeft: 4 }}>
                      {t.side.toUpperCase()}
                    </span>
                  </div>
                  <div className="hist-card-time mono">{t.time}</div>
                </div>
                <div className={"hist-card-pnl mono " + (t.pnl >= 0 ? "profit" : "loss")}>
                  {t.pnl >= 0 ? "+" : ""}
                  {fmtUSD(t.pnl)}
                </div>
              </header>
              <dl className="hist-card-grid">
                <div>
                  <dt>Size</dt>
                  <dd className="mono">{t.size.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd className="mono">{t.entry.toFixed(dec)}</dd>
                </div>
                <div>
                  <dt>Exit</dt>
                  <dd className="mono">{t.exit.toFixed(dec)}</dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd className="mono muted">{fmtUSD(t.fee)}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PerpsPositionCards() {
  return (
    <div className="pos-cards" aria-label="Open perp positions">
      {MOCK_POSITIONS.map((p, i) => {
        const m = ALL_MARKETS.find((mm) => mm.sym === p.sym);
        const dec = p.entry < 10 ? 4 : p.entry < 1000 ? 2 : 1;
        const pnlPct = (p.pnl / p.margin) * 100;
        return (
          <article key={i} className="pos-card">
            <header className="pos-card-head">
              <FlagPair a={m?.flagA || "◎"} b={m?.flagB || "$"} size={22} />
              <div className="pos-card-meta">
                <div className="pos-card-sym">{p.sym}</div>
                <div className="pos-card-sub">{p.leverage}x · Cross</div>
              </div>
              <span className={"side-tag " + p.side}>{p.side.toUpperCase()}</span>
              <div className={"pos-card-pnl mono " + (p.pnl >= 0 ? "profit" : "loss")}>
                <div className="pos-card-pnl-v">
                  {p.pnl >= 0 ? "+" : ""}
                  {fmtUSD(p.pnl)}
                </div>
                <div className="pos-card-pnl-pct">{fmtPct(pnlPct)}</div>
              </div>
            </header>
            <dl className="pos-card-grid">
              <div>
                <dt>Size</dt>
                <dd className="mono">{p.size.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Margin</dt>
                <dd className="mono">{fmtUSD(p.margin)}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd className="mono">{p.entry.toFixed(dec)}</dd>
              </div>
              <div>
                <dt>Mark</dt>
                <dd className="mono">{p.mark.toFixed(dec)}</dd>
              </div>
              <div>
                <dt>Liq.</dt>
                <dd className="mono" style={{ color: "var(--loss-ink)" }}>
                  {p.liq.toFixed(dec)}
                </dd>
              </div>
              <div>
                <dt>TP/SL</dt>
                <dd>
                  <button className="copy-btn" style={{ padding: "3px 8px" }}>
                    <Icon name="plus" size={10} /> Set
                  </button>
                </dd>
              </div>
            </dl>
            <button className="pos-card-close">Close position</button>
          </article>
        );
      })}
    </div>
  );
}

function PerpsPositionsView() {
  const totalPnl = MOCK_POSITIONS.reduce((s, p) => s + p.pnl, 0);
  const totalMargin = MOCK_POSITIONS.reduce((s, p) => s + p.margin, 0);
  return (
    <div className="pp-view">
      <div className="history-summary">
        <div className="hsum-card">
          <div className="hsum-l">
            Open Positions <Hint w={220}>How many perp trades you have running right now.</Hint>
          </div>
          <div className="hsum-v mono">{MOCK_POSITIONS.length}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Unrealized PnL{" "}
            <Hint w={240}>Profit or loss if you closed every position at the current mark price.</Hint>
          </div>
          <div className={"hsum-v mono " + (totalPnl >= 0 ? "profit" : "loss")}>
            {totalPnl >= 0 ? "+" : ""}
            {fmtUSD(totalPnl)}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Margin Used <Hint w={240}>Collateral currently locked up backing your open positions.</Hint>
          </div>
          <div className="hsum-v mono">{fmtUSD(totalMargin)}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open Orders <Hint w={220}>Pending limit orders waiting for price to be reached.</Hint>
          </div>
          <div className="hsum-v mono">{MOCK_ORDERS.length}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Funding (24h){" "}
            <Hint w={240}>Net funding paid (−) or received (+) on perpetual positions in the last 24h.</Hint>
          </div>
          <div className="hsum-v mono" style={{ color: "var(--profit-ink)" }}>
            +$3.84
          </div>
        </div>
      </div>
      <table className="table table-desktop-only">
        <thead>
          <tr>
            <th>Market</th>
            <th>
              Side <Hint w={220}>Long bets the price rises. Short bets it falls.</Hint>
            </th>
            <th>
              Size <Hint w={220}>Notional value of the position in the base currency.</Hint>
            </th>
            <th>
              Entry <Hint w={200}>Average price at which you opened.</Hint>
            </th>
            <th>
              Mark <Hint w={220}>Current price used to value the position.</Hint>
            </th>
            <th>
              Liq. Price <Hint w={260}>If the mark price reaches this, your position is liquidated.</Hint>
            </th>
            <th>
              Margin <Hint w={220}>Collateral locked up backing this position.</Hint>
            </th>
            <th>
              PnL <Hint w={220}>Profit or loss right now, before fees.</Hint>
            </th>
            <th>
              TP/SL <Hint w={260}>Take-profit and stop-loss orders that auto-close this position.</Hint>
            </th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_POSITIONS.map((p, i) => {
            const m = ALL_MARKETS.find((mm) => mm.sym === p.sym);
            const dec = p.entry < 10 ? 4 : p.entry < 1000 ? 2 : 1;
            const pnlPct = (p.pnl / p.margin) * 100;
            return (
              <tr key={i}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <FlagPair a={m?.flagA || "◎"} b={m?.flagB || "$"} size={20} />
                    <div>
                      <div style={{ fontWeight: 800 }}>{p.sym}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 700 }}>
                        {p.leverage}x · Cross
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={"side-tag " + p.side}>{p.side.toUpperCase()}</span>
                </td>
                <td className="mono">{p.size.toLocaleString()}</td>
                <td className="mono">{p.entry.toFixed(dec)}</td>
                <td className="mono">{p.mark.toFixed(dec)}</td>
                <td className="mono" style={{ color: "var(--loss-ink)" }}>
                  {p.liq.toFixed(dec)}
                </td>
                <td className="mono">{fmtUSD(p.margin)}</td>
                <td
                  className="mono"
                  style={{ color: p.pnl >= 0 ? "var(--profit-ink)" : "var(--loss-ink)", fontWeight: 800 }}
                >
                  {p.pnl >= 0 ? "+" : ""}
                  {fmtUSD(p.pnl)}
                  <div style={{ fontSize: 10.5, opacity: 0.8 }}>{fmtPct(pnlPct)}</div>
                </td>
                <td>
                  <button className="copy-btn">
                    <Icon name="plus" size={10} /> Set
                  </button>
                </td>
                <td>
                  <button className="close-btn">Close</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PerpsPositionCards />
    </div>
  );
}

function LoanPositionsView() {
  const positions = LOAN_POSITIONS;
  const markets = LOAN_MARKETS;
  const tokens = LOAN_TOKENS;
  const hubs = LOAN_HUBS;
  const totalSupplied = positions.filter((p) => p.kind === "supply").reduce((s, p) => s + p.value, 0);
  const totalBorrowed = positions.filter((p) => p.kind === "borrow").reduce((s, p) => s + p.value, 0);
  const netWorth = totalSupplied - totalBorrowed;
  const supplyCount = positions.filter((p) => p.kind === "supply").length;
  const borrowCount = positions.filter((p) => p.kind === "borrow").length;

  return (
    <div className="pp-view">
      <div className="history-summary">
        <div className="hsum-card">
          <div className="hsum-l">
            Net worth <Hint w={220}>Supplied minus borrowed across all loan/borrow markets.</Hint>
          </div>
          <div className="hsum-v mono">{fmtUSD(netWorth)}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Supplied <Hint w={220}>Funds you&apos;ve deposited earning yield.</Hint>
          </div>
          <div className="hsum-v mono" style={{ color: "var(--profit-ink)" }}>
            {fmtUSD(totalSupplied)}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Borrowed <Hint w={220}>Loans you&apos;ve taken accruing interest.</Hint>
          </div>
          <div className="hsum-v mono" style={{ color: "var(--loss-ink)" }}>
            {fmtUSD(totalBorrowed)}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open lends <Hint w={220}>Number of supply positions across all hubs.</Hint>
          </div>
          <div className="hsum-v mono">{supplyCount}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open borrows <Hint w={220}>Number of borrow positions across all hubs.</Hint>
          </div>
          <div className="hsum-v mono">{borrowCount}</div>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>
              Kind <Hint w={220}>Whether you&apos;re supplying (earning) or borrowing (paying).</Hint>
            </th>
            <th>Market</th>
            <th>
              Hub <Hint w={220}>Which chain hub this position lives on.</Hint>
            </th>
            <th>Amount</th>
            <th>Value</th>
            <th>
              Rate <Hint w={220}>Live APY (supply) or APR (borrow). Floats with utilization.</Hint>
            </th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const m = markets.find((mm) => mm.id === p.marketId);
            if (!m) return null;
            const tok = tokens[m.loan];
            const hub = hubs[m.hub];
            const rate = p.kind === "supply" ? m.supply : m.borrow;
            return (
              <tr key={i}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="fx-chip" style={{ width: 24, height: 24, fontSize: 17 }}>
                      {tok.flag}
                    </span>
                    <div>
                      <div style={{ fontWeight: 800 }}>{tok.sym}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 700 }}>{tok.name}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={"side-tag " + (p.kind === "supply" ? "long" : "short")}>
                    {p.kind === "supply" ? "LEND" : "BORROW"}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontWeight: 800 }}>
                      <span className="mkt-loan">{m.loan}</span>
                      <span className="mkt-slash">/</span>
                      <span className="mkt-coll">{m.coll}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 700 }}>
                      {Math.round(m.lltv * 100)}% LLTV
                    </span>
                  </div>
                </td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 12.5 }}>
                    <span
                      className="hub-pip"
                      style={{ background: hub.color, width: 12, height: 12, fontSize: 7 }}
                    >
                      {hub.glyph}
                    </span>
                    {hub.short}
                  </span>
                </td>
                <td className="mono">
                  {p.amount.toLocaleString(undefined, { maximumFractionDigits: tok.decimals })}{" "}
                  <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>{tok.sym}</span>
                </td>
                <td className="mono">${p.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td
                  className="mono"
                  style={{ color: p.kind === "supply" ? "var(--profit-ink)" : "var(--loss-ink)", fontWeight: 800 }}
                >
                  {p.kind === "supply" ? "+" : "−"}
                  {rate.toFixed(2)}%
                </td>
                <td>
                  <button className="close-btn">{p.kind === "supply" ? "Withdraw" : "Repay"}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionsOnlyTab() {
  const [sub, setSub] = useState("perps");
  const loanPositions = LOAN_POSITIONS;
  return (
    <div className="positions-only-tab">
      <div className="pp-subtabs">
        <button
          className={"pp-subtab " + (sub === "perps" ? "active" : "")}
          onClick={() => setSub("perps")}
        >
          <Icon name="candle" size={13} />
          <span>Trading</span>
          <span className="pp-subtab-count">{MOCK_POSITIONS.length}</span>
        </button>
        <button
          className={"pp-subtab " + (sub === "loan" ? "active" : "")}
          onClick={() => setSub("loan")}
        >
          <Icon name="vault" size={13} />
          <span>Loan / Borrow</span>
          <span className="pp-subtab-count">{loanPositions.length}</span>
        </button>
      </div>
      {sub === "perps" && <PerpsPositionsView />}
      {sub === "loan" && <LoanPositionsView />}
    </div>
  );
}

function TradeTab({
  market,
  marketSym,
  setMarketSym,
}: {
  market: Market;
  marketSym: string;
  setMarketSym: (s: string) => void;
}) {
  // Switch to the dedicated mobile layout under the `lg` breakpoint. Matches
  // the island.css cutover at 1023.98px so the two systems agree.
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  if (isMobile) {
    return (
      <div className="trade-tab trade-tab-mobile">
        <MobileTrade market={market} marketSym={marketSym} setMarketSym={setMarketSym} />
      </div>
    );
  }
  return (
    <div className="trade-tab">
      <div className="trade-layout">
        <div className="t-orderbook">
          <OrderbookCard market={market} />
        </div>
        <div className="t-chart">
          <ChartCard market={market} />
        </div>
        <div className="t-order">
          <OrderPanelCard market={market} />
        </div>
      </div>
    </div>
  );
}

export default function TradeIsland() {
  const [tab, setTab] = useState("trade");
  const [marketSym, setMarketSym] = useState("EUR/USD");
  const [arcade, setArcade] = useState(false);
  const baseMarket = useMemo(
    () => ALL_MARKETS.find((m) => m.sym === marketSym) || FX_MARKETS[0],
    [marketSym]
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const market = useMemo(() => {
    if (!tick) return baseMarket;
    const drift = (Math.sin(tick * 0.7) + Math.sin(tick * 0.31)) * baseMarket.price * 0.0006;
    return { ...baseMarket, price: baseMarket.price + drift };
  }, [baseMarket, tick]);

  const acct = 125420.5 + MOCK_POSITIONS.reduce((s, p) => s + p.pnl, 0);
  const totalPnl = MOCK_POSITIONS.reduce((s, p) => s + p.pnl, 0);
  const dec = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;

  return (
    <div className={"island " + (arcade && tab === "trade" ? "arcade-on" : "") + " tab-" + tab}>
      <header className="island-header">
        <div className="island-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"island-tab " + (tab === t.id ? "active" : "")}
              onClick={() => {
                setTab(t.id);
                if (t.id !== "trade") setArcade(false);
              }}
              title={TAB_HINTS[t.id]}
            >
              <Icon name={t.icon} size={14} />
              <span>{t.label}</span>
              {t.count != null && <span className="tab-pill">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="island-summary">
          {tab === "trade" && (
            <MarketPicker market={market} setMarketSym={setMarketSym} />
          )}
          <div className="acct-mini">
            <span className="acct-l">Equity</span>
            <span className="mono acct-v">{fmtUSD(acct)}</span>
            <span className={"pill " + (totalPnl >= 0 ? "profit" : "loss")}>
              {totalPnl >= 0 ? "+" : ""}
              {fmtUSD(totalPnl)}
            </span>
          </div>
          {tab === "trade" && (
            <button
              className={"island-collapse mode-switch " + (arcade ? "arcade" : "")}
              onClick={() => setArcade(!arcade)}
              title={arcade ? "Back to Pro Mode" : "Enter Arcade Mode"}
            >
              <span className="mode-label">{arcade ? "PRO" : "ARCADE"}</span>
              <span className="mode-glyph">{arcade ? "⊞" : "✦"}</span>
            </button>
          )}
        </div>
      </header>

      <div className={"island-body " + (arcade && tab === "trade" ? "arcade-on" : "")}>
        {tab === "trade" && !arcade && (
          <TradeTab market={market} marketSym={marketSym} setMarketSym={setMarketSym} />
        )}
        {tab === "trade" && arcade && <ArcadeRoom market={market} onClose={() => setArcade(false)} />}
        {tab === "positions" && <PositionsOnlyTab />}
        {tab === "loan" && <LoanTab />}
        {tab === "leaders" && <LeadersTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}
