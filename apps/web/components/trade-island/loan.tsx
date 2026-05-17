"use client";

import { useMemo, useState } from "react";
import { Hint } from "./hint";

export interface LoanToken {
  sym: string;
  name: string;
  flag: string;
  price: number;
  decimals: number;
  mock: boolean;
}

export interface LoanHub {
  id: string;
  name: string;
  short: string;
  color: string;
  glyph: string;
}

export type LoanMarketStatus = "live" | "paused" | "stale";

export interface LoanMarket {
  id: string;
  hub: string;
  loan: string;
  coll: string;
  supply: number;
  borrow: number;
  util: number;
  lltv: number;
  tvl: number;
  status: LoanMarketStatus;
  trend: "up" | "down";
}

export type LoanPositionKind = "supply" | "borrow";

export interface LoanPosition {
  marketId: string;
  kind: LoanPositionKind;
  amount: number;
  value: number;
}

export interface LoanAction {
  id: string;
  label: string;
  verb: string;
  side: LoanPositionKind;
  hint: string;
}

export const LOAN_TOKENS: Record<string, LoanToken> = {
  USDC: { sym: "USDC", name: "USD Coin", flag: "🇺🇸", price: 1.0, decimals: 2, mock: false },
  EURC: { sym: "EURC", name: "Euro Coin", flag: "🇪🇺", price: 1.084, decimals: 2, mock: false },
  mAUDF: { sym: "mAUDF", name: "Australian Dollar", flag: "🇦🇺", price: 0.6648, decimals: 2, mock: true },
  mJPYC: { sym: "mJPYC", name: "Japanese Yen", flag: "🇯🇵", price: 0.00648, decimals: 0, mock: true },
  mMXNB: { sym: "mMXNB", name: "Mexican Peso", flag: "🇲🇽", price: 0.0585, decimals: 2, mock: true },
  mKRW1: { sym: "mKRW1", name: "Korean Won", flag: "🇰🇷", price: 0.000726, decimals: 0, mock: true },
  mZCHF: { sym: "mZCHF", name: "Swiss Franc", flag: "🇨🇭", price: 1.135, decimals: 2, mock: true },
};

export const LOAN_HUBS: Record<string, LoanHub> = {
  arc: { id: "arc", name: "Arc Hub", short: "Arc", color: "#6b5bff", glyph: "◆" },
  fuji: { id: "fuji", name: "Fuji Hub", short: "Fuji", color: "#e84142", glyph: "▲" },
};

export const LOAN_MARKETS: LoanMarket[] = [
  { id: "arc-usdc-eurc", hub: "arc", loan: "USDC", coll: "EURC", supply: 4.42, borrow: 7.04, util: 0.66, lltv: 0.86, tvl: 1820000, status: "live", trend: "up" },
  { id: "arc-eurc-usdc", hub: "arc", loan: "EURC", coll: "USDC", supply: 4.10, borrow: 6.42, util: 0.58, lltv: 0.86, tvl: 1240000, status: "live", trend: "up" },
  { id: "arc-mjpyc-usdc", hub: "arc", loan: "mJPYC", coll: "USDC", supply: 0.92, borrow: 2.40, util: 0.71, lltv: 0.82, tvl: 540000, status: "live", trend: "down" },
  { id: "arc-maudf-usdc", hub: "arc", loan: "mAUDF", coll: "USDC", supply: 8.40, borrow: 11.20, util: 0.42, lltv: 0.80, tvl: 220000, status: "live", trend: "up" },
  { id: "arc-mmxnb-usdc", hub: "arc", loan: "mMXNB", coll: "USDC", supply: 9.40, borrow: 12.60, util: 0.38, lltv: 0.72, tvl: 142000, status: "stale", trend: "down" },
  { id: "arc-mkrw1-usdc", hub: "arc", loan: "mKRW1", coll: "USDC", supply: 3.40, borrow: 5.80, util: 0.46, lltv: 0.75, tvl: 86000, status: "live", trend: "up" },
  { id: "arc-mzchf-usdc", hub: "arc", loan: "mZCHF", coll: "USDC", supply: 2.10, borrow: 4.20, util: 0.62, lltv: 0.82, tvl: 220000, status: "paused", trend: "down" },
  { id: "fuji-usdc-eurc", hub: "fuji", loan: "USDC", coll: "EURC", supply: 4.20, borrow: 6.84, util: 0.62, lltv: 0.86, tvl: 412600, status: "live", trend: "up" },
];

export const LOAN_POSITIONS: LoanPosition[] = [
  { marketId: "arc-usdc-eurc", kind: "supply", amount: 4820.4, value: 4820.4 },
  { marketId: "fuji-usdc-eurc", kind: "supply", amount: 1500.0, value: 1500.0 },
  { marketId: "arc-mjpyc-usdc", kind: "borrow", amount: 320000, value: 2073.6 },
];

const ACTIONS: LoanAction[] = [
  { id: "lend", label: "Lend", verb: "lend", side: "supply", hint: "Deposit the loan asset to earn yield." },
  { id: "borrow", label: "Borrow", verb: "borrow", side: "borrow", hint: "Lock collateral and take a loan in the loan asset." },
  { id: "withdraw", label: "Withdraw", verb: "withdraw", side: "supply", hint: "Pull supplied funds back to your wallet." },
  { id: "repay", label: "Repay", verb: "repay", side: "borrow", hint: "Pay back some or all of your debt." },
];

const fmtCompact = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "k" : "$" + n.toFixed(0);

const fmtAmt = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : n.toFixed(0);

export function FxChip({ sym, size = 28 }: { sym: string; size?: number }) {
  const t = LOAN_TOKENS[sym];
  if (!t) return null;
  return (
    <span
      className="fx-chip"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.7) }}
      title={t.name}
    >
      {t.flag}
    </span>
  );
}

export function HubPip({ hub, size = 14 }: { hub: LoanHub; size?: number }) {
  return (
    <span
      className="hub-pip"
      style={{ background: hub.color, width: size, height: size, fontSize: Math.round(size * 0.55) }}
      title={hub.name}
    >
      {hub.glyph}
    </span>
  );
}

export function StatusTag({ status }: { status: LoanMarketStatus }) {
  if (status === "live") return <span className="lo-st lo-st-live">Live</span>;
  if (status === "paused") return <span className="lo-st lo-st-paused">Paused</span>;
  if (status === "stale") return <span className="lo-st lo-st-stale">Stale</span>;
  return null;
}

export function MarketSpark({ market }: { market: LoanMarket }) {
  const data = useMemo(() => {
    let seed = market.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const arr: number[] = [];
    let v = market.util * 0.92;
    for (let i = 0; i < 60; i++) {
      v += (rand() - 0.5) * 0.025;
      v = Math.max(0.18, Math.min(0.92, v));
      arr.push(v);
    }
    arr.push(market.util);
    return arr;
  }, [market.id, market.util]);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const W = 320;
  const H = 80;
  const pad = 4;
  const innerH = H - pad * 2;
  const pts: [number, number][] = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = pad + innerH - ((v - min) / (max - min || 1)) * innerH;
    return [x, y];
  });
  const path = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x.toFixed(2)},${y.toFixed(2)}`;
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    return acc + ` Q${cx.toFixed(2)},${py.toFixed(2)} ${cx.toFixed(2)},${((py + y) / 2).toFixed(2)} T${x.toFixed(2)},${y.toFixed(2)}`;
  }, "");
  const fill = path + ` L${W},${H} L0,${H} Z`;
  const up = market.trend === "up";
  const stroke = up ? "var(--profit-ink)" : "var(--loss-ink)";
  const gradId = "sg-" + market.id;
  const lastX = pts[pts.length - 1][0];
  const lastY = pts[pts.length - 1][1];
  return (
    <svg className="lo-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity=".28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="3.2" fill="var(--surface)" stroke={stroke} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MarketsTable({ market, onSelect }: { market: LoanMarket; onSelect: (id: string) => void }) {
  const [hubFilter, setHubFilter] = useState("all");
  const visible = LOAN_MARKETS.filter((m) => hubFilter === "all" || m.hub === hubFilter);

  return (
    <div className="lo-table-wrap">
      <div className="lo-table-head">
        <span className="lo-eyebrow">Markets</span>
        <div className="lo-hub-filter">
          {["all", "arc", "fuji"].map((h) => (
            <button
              key={h}
              className={"lo-hub-btn " + (hubFilter === h ? "active" : "")}
              onClick={() => setHubFilter(h)}
            >
              {h === "all" ? "All" : LOAN_HUBS[h].short}
              <span className="lo-hub-btn-count">
                {h === "all" ? LOAN_MARKETS.length : LOAN_MARKETS.filter((m) => m.hub === h).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="lo-table">
        <div className="lo-table-thead">
          <span>Market</span>
          <span style={{ textAlign: "right" }}>Supply</span>
          <span style={{ textAlign: "right" }}>Borrow</span>
          <span style={{ textAlign: "right" }}>Util</span>
          <span style={{ textAlign: "right" }}>TVL</span>
          <span style={{ textAlign: "right" }}>30d</span>
        </div>
        {visible.map((m) => {
          const sel = m.id === market.id;
          const hub = LOAN_HUBS[m.hub];
          const disabled = m.status !== "live";
          return (
            <button
              key={m.id}
              className={"lo-trow " + (sel ? "sel " : "") + (disabled ? "dim " : "")}
              onClick={() => onSelect(m.id)}
            >
              <div className="lo-trow-pair">
                <span className="lo-trow-flags">
                  <FxChip sym={m.loan} size={26} />
                  <FxChip sym={m.coll} size={26} />
                </span>
                <div className="lo-trow-meta">
                  <div className="lo-trow-syms">
                    <span className="mkt-loan">{m.loan}</span>
                    <span className="mkt-slash">/</span>
                    <span className="mkt-coll">{m.coll}</span>
                    {m.status !== "live" && <StatusTag status={m.status} />}
                  </div>
                  <div className="lo-trow-hub">
                    <HubPip hub={hub} size={10} />
                    <span>{hub.short}</span>
                    <span className="lo-trow-lltv">· {Math.round(m.lltv * 100)}% LLTV</span>
                  </div>
                </div>
              </div>
              <span className="mono profit lo-trow-num">{m.supply.toFixed(2)}%</span>
              <span className="mono loss lo-trow-num">{m.borrow.toFixed(2)}%</span>
              <span className="mono lo-trow-num">{Math.round(m.util * 100)}%</span>
              <span className="mono lo-trow-num">{fmtCompact(m.tvl)}</span>
              <span className="lo-trow-spark">
                <MarketSpark market={m} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function findInverse(market: LoanMarket): LoanMarket | undefined {
  return LOAN_MARKETS.find((m) => m.hub === market.hub && m.loan === market.coll && m.coll === market.loan);
}

interface ActionCardProps {
  market: LoanMarket;
  action: string;
  setAction: (id: string) => void;
  amount: string;
  setAmount: (val: string) => void;
  onFlipMarket?: (id: string) => void;
}

export function ActionCard({ market, action, setAction, amount, setAmount, onFlipMarket }: ActionCardProps) {
  const loan = LOAN_TOKENS[market.loan];
  const A = ACTIONS.find((a) => a.id === action) || ACTIONS[0];
  const rate = A.side === "supply" ? market.supply : market.borrow;
  const rateLabel = A.side === "supply" ? "APY" : "APR";
  const balance = action === "withdraw" || action === "repay" ? 4820.4 : 12840.21;
  const amt = parseFloat(amount) || 0;
  const usd = amt * loan.price;
  const inverse = findInverse(market);

  const yearly = (usd * rate) / 100;
  const monthly = yearly / 12;
  const daily = yearly / 365;

  let impactTitle: string;
  let impactBig: string;
  let impactBigClass: string;
  let impactMini1: [string, string];
  let impactMini2: [string, string];
  if (action === "lend") {
    impactTitle = "You will earn";
    impactBig = "+$" + yearly.toFixed(2);
    impactBigClass = "profit";
    impactMini1 = ["per month", "+$" + monthly.toFixed(2)];
    impactMini2 = ["per day", "+$" + daily.toFixed(2)];
  } else if (action === "borrow") {
    impactTitle = "You will pay";
    impactBig = "−$" + yearly.toFixed(2);
    impactBigClass = "loss";
    impactMini1 = ["per month", "−$" + monthly.toFixed(2)];
    impactMini2 = ["per day", "−$" + daily.toFixed(2)];
  } else if (action === "withdraw") {
    impactTitle = "You will receive";
    impactBig = "$" + usd.toFixed(2);
    impactBigClass = "ink";
    impactMini1 = ["in " + loan.sym, amt.toLocaleString(undefined, { maximumFractionDigits: 2 })];
    impactMini2 = ["stops earning", "−$" + monthly.toFixed(2) + "/mo"];
  } else {
    impactTitle = "You will free";
    impactBig = "$" + usd.toFixed(2);
    impactBigClass = "ink";
    impactMini1 = ["debt left", "−$" + Math.max(0, 2073.6 - usd).toFixed(2)];
    impactMini2 = ["interest saved", "−$" + monthly.toFixed(2) + "/mo"];
  }

  return (
    <section className="lo-action">
      <div className="lo-action-head">
        <span className="lo-eyebrow">Action</span>
        <span
          className="lo-rate mono"
          style={{ color: A.side === "supply" ? "var(--profit-ink)" : "var(--loss-ink)" }}
        >
          {rate.toFixed(2)}% {rateLabel}
        </span>
      </div>

      <div className="lo-tabs">
        {ACTIONS.map((a, i) => (
          <button
            key={a.id}
            className={"lo-tab tone-" + (i + 1) + (action === a.id ? " active" : "")}
            onClick={() => setAction(a.id)}
            title={a.hint}
          >
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <div className="lo-amount-shell">
        <input
          className="lo-amount-input mono"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.00"
          inputMode="decimal"
        />
        {inverse && (
          <button
            className="lo-flip"
            onClick={() => onFlipMarket && onFlipMarket(inverse.id)}
            title={`Flip to ${inverse.loan} / ${inverse.coll}`}
          >
            <span className="lo-flip-pair">
              <span className="mkt-loan">{market.loan}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 10h13M16 6l4 4-4 4M17 14H4M8 18l-4-4 4-4" />
              </svg>
              <span className="mkt-coll">{market.coll}</span>
            </span>
            <span className="lo-flip-l">Flip</span>
          </button>
        )}
      </div>

      <div className="lo-amount-foot">
        <span className="lo-balance">
          BALANCE <span className="mono">{balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {loan.sym}</span>
          <span className="lo-balance-usd mono">≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </span>
        <div className="lo-amount-quick">
          <button onClick={() => setAmount((balance / 4).toString())}>25%</button>
          <button onClick={() => setAmount((balance / 2).toString())}>50%</button>
          <button onClick={() => setAmount((balance * 0.75).toString())}>75%</button>
          <button onClick={() => setAmount(balance.toString())}>MAX</button>
        </div>
      </div>

      <button className="lo-cta">{A.verb}</button>

      <div className="lo-impact">
        <div className="lo-impact-head">
          <span className="lo-impact-title">{impactTitle}</span>
          <span className="lo-impact-period">per year</span>
        </div>
        <div className={"lo-impact-big mono " + impactBigClass}>{impactBig}</div>
        <div className="lo-impact-grid">
          <div className="lo-impact-mini">
            <span className="lo-impact-mini-l">{impactMini1[0]}</span>
            <span className={"mono lo-impact-mini-v " + impactBigClass}>{impactMini1[1]}</span>
          </div>
          <div className="lo-impact-mini">
            <span className="lo-impact-mini-l">{impactMini2[0]}</span>
            <span className={"mono lo-impact-mini-v " + impactBigClass}>{impactMini2[1]}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Positions({ onJump }: { onJump: (id: string) => void }) {
  return (
    <section className="lo-positions">
      <div className="lo-positions-head">
        <div className="lo-positions-title">
          Your positions
          <Hint w={240}>Open positions across both hubs. Click to jump to that market.</Hint>
        </div>
        <span className="lo-positions-addr mono">0x15b0…b5df32</span>
      </div>
      <div className="lo-positions-table">
        <div className="lo-positions-thead">
          <span>Asset</span>
          <span>Market</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span style={{ textAlign: "right" }}>Value</span>
          <span style={{ textAlign: "right" }}>Rate</span>
        </div>
        {LOAN_POSITIONS.map((p, i) => {
          const m = LOAN_MARKETS.find((mm) => mm.id === p.marketId);
          if (!m) return null;
          const tok = LOAN_TOKENS[m.loan];
          const rate = p.kind === "supply" ? m.supply : m.borrow;
          const hub = LOAN_HUBS[m.hub];
          return (
            <button key={i} className="lo-positions-row" onClick={() => onJump(m.id)}>
              <div className="lo-pos-asset">
                <FxChip sym={tok.sym} size={24} />
                <div>
                  <div className="lo-pos-sym">
                    {tok.sym}
                    <span className={"lo-pos-tag " + p.kind}>{p.kind === "supply" ? "Supplied" : "Borrowed"}</span>
                  </div>
                  <div className="lo-pos-name">{tok.name}</div>
                </div>
              </div>
              <div className="lo-pos-market">
                <span>
                  <span className="mkt-loan">{m.loan}</span>
                  <span className="mkt-slash">/</span>
                  <span className="mkt-coll">{m.coll}</span>
                </span>
                <span className="lo-pos-hub">
                  via <HubPip hub={hub} size={10} /> {hub.short}
                </span>
              </div>
              <div className="lo-pos-num mono">{fmtAmt(p.amount)}</div>
              <div className="lo-pos-num mono">{fmtCompact(p.value)}</div>
              <div
                className="lo-pos-num mono"
                style={{ color: p.kind === "supply" ? "var(--profit-ink)" : "var(--loss-ink)" }}
              >
                {p.kind === "supply" ? "+" : "−"}
                {rate.toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function LoanTab() {
  const [selectedId, setSelectedId] = useState("arc-usdc-eurc");
  const [action, setAction] = useState("lend");
  const [amount, setAmount] = useState("");

  const market = LOAN_MARKETS.find((m) => m.id === selectedId) || LOAN_MARKETS[0];

  const totalSupplied = LOAN_POSITIONS.filter((p) => p.kind === "supply").reduce((s, p) => s + p.value, 0);
  const totalBorrowed = LOAN_POSITIONS.filter((p) => p.kind === "borrow").reduce((s, p) => s + p.value, 0);
  const netWorth = totalSupplied - totalBorrowed;

  return (
    <div className="lo-shell">
      <div className="lo-hero">
        <div className="lo-hero-l">
          <span className="lo-eyebrow">FX Money Market</span>
          <h1 className="lo-hero-h">Lend &amp; borrow stablecoin FX</h1>
          <p className="lo-hero-p">
            Park your dollars to earn yield, or borrow another currency against them. Live on Arc and Fuji.
          </p>
        </div>
        <div className="lo-hero-r">
          <div className="lo-stat">
            <span className="lo-stat-l">Net worth</span>
            <span className="lo-stat-v mono">${netWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="lo-stat">
            <span className="lo-stat-l">Supplied</span>
            <span className="lo-stat-v mono profit">${totalSupplied.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="lo-stat">
            <span className="lo-stat-l">Borrowed</span>
            <span className="lo-stat-v mono loss">${totalBorrowed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      <div className="lo-strip">
        <div className="lo-strip-market">
          <MarketsTable market={market} onSelect={setSelectedId} />
        </div>
        <ActionCard
          market={market}
          action={action}
          setAction={setAction}
          amount={amount}
          setAmount={setAmount}
          onFlipMarket={setSelectedId}
        />
      </div>
    </div>
  );
}
