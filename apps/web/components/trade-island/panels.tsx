"use client";

import { useMemo, useState } from "react";
import { Icon, FlagPair, fmtUSD, fmtPct, makeOrderbook, type Market } from "./data";
import { Hint } from "./hint";
import { CandleChart } from "./chart";

export function OrderbookCard({ market }: { market: Market }) {
  const tickSize = market.price < 10 ? 0.0001 : market.price < 1000 ? 0.01 : 0.5;
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const ob = useMemo(() => makeOrderbook(market.price, tickSize, 11), [market.sym, market.price, tickSize]);
  const spread = ob.asks[0].price - ob.bids[0].price;
  const spreadPct = (spread / market.price) * 100;
  return (
    <div className="card orderbook-card">
      <div className="card-head ob-head">
        <div className="card-title">
          <span className="card-icon">
            <Icon name="list" size={15} />
          </span>
          <span>
            Order Book{" "}
            <Hint w={260}>
              Live buy (bids, green) and sell (asks, pink) orders at each price. The deeper the row, the more size sitting there.
            </Hint>
          </span>
        </div>
        <span className="pill muted" title="Tick size — the smallest price increment in this market">
          {tickSize < 1 ? tickSize.toFixed(4) : tickSize}
        </span>
      </div>
      <div className="ob-cols">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div className="ob-rows" style={{ display: "flex", flexDirection: "column" }}>
        {[...ob.asks].reverse().map((a, i) => (
          <div key={"a" + i} className="ob-row ask">
            <div className="bar" style={{ width: `${(a.total / ob.maxTotal) * 100}%` }} />
            <span className="v price mono">{a.price.toFixed(decimals)}</span>
            <span className="v size mono">{a.size.toFixed(2)}</span>
            <span className="v total mono">{a.total.toFixed(2)}</span>
          </div>
        ))}
        <div className="ob-spread">
          <span className="last mono">
            {market.price.toFixed(decimals)}
            <span style={{ color: market.change >= 0 ? "var(--profit-ink)" : "var(--loss-ink)" }}>
              {market.change >= 0 ? "↑" : "↓"}
            </span>
          </span>
          <span className="meta">
            Spread {spread.toFixed(decimals + 1)} ({spreadPct.toFixed(3)}%)
          </span>
        </div>
        {ob.bids.map((b, i) => (
          <div key={"b" + i} className="ob-row bid">
            <div className="bar" style={{ width: `${(b.total / ob.maxTotal) * 100}%` }} />
            <span className="v price mono">{b.price.toFixed(decimals)}</span>
            <span className="v size mono">{b.size.toFixed(2)}</span>
            <span className="v total mono">{b.total.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderPanelCard({ market }: { market: Market }) {
  const [orderType, setOrderType] = useState("limit");
  const [margin, setMargin] = useState("cross");
  const [lev, setLev] = useState(market.leverage > 50 ? 25 : 10);
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const sizeV = parseFloat(size) || 0;
  const priceV = parseFloat(price) || market.price;
  const notional = sizeV * priceV;
  const reqMargin = notional / lev;
  const liqLong = priceV * (1 - 0.8 / lev);
  const liqShort = priceV * (1 + 0.8 / lev);
  const types = ["Market", "Limit", "Stop", "TP/SL"];
  const presets = [1, 2, 5, 10, 25, 50, 100];
  const sizePcts = [25, 50, 75, 100];

  return (
    <div className="card order-card">
      <div className="order-head">
        <div className="card-title">
          <span className="card-icon">
            <Icon name="bolt" size={15} />
          </span>
          <span>Place Order</span>
        </div>
        <div className="margin-tabs">
          <button
            className={margin === "cross" ? "active" : ""}
            onClick={() => setMargin("cross")}
            title="Cross margin: all your free collateral backs every position. Lower liquidation risk but losses can cascade."
          >
            Cross
          </button>
          <button
            className={margin === "iso" ? "active" : ""}
            onClick={() => setMargin("iso")}
            title="Isolated margin: only the margin you set backs this position. Limits your downside to that amount."
          >
            Isolated
          </button>
        </div>
      </div>
      <div className="order-body">
        <div className="order-type-tabs">
          {types.map((t) => (
            <button
              key={t}
              className={orderType === t.toLowerCase() ? "active" : ""}
              onClick={() => setOrderType(t.toLowerCase())}
              title={
                t === "Market"
                  ? "Buy or sell immediately at the best available price."
                  : t === "Limit"
                  ? "Set the price you're willing to pay; fills only at that price or better."
                  : t === "Stop"
                  ? "Triggers a market order once the price crosses your stop level."
                  : "Set take-profit and stop-loss alongside the entry."
              }
            >
              {t}
            </button>
          ))}
        </div>

        <div className="leverage-block">
          <div className="lev-row">
            <span className="field-label" style={{ display: "block" }}>
              Leverage <Hint w={260}>Multiplies your buying power. Higher leverage = smaller move can liquidate you.</Hint>
            </span>
            <div className="lev-control">
              <button onClick={() => setLev(Math.max(1, lev - 1))}>
                <Icon name="minus" size={12} />
              </button>
              <span className="lev-value">{lev}x</span>
              <button onClick={() => setLev(Math.min(market.leverage, lev + 1))}>
                <Icon name="plus" size={12} />
              </button>
            </div>
          </div>
          <div
            className="slider"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
              setLev(Math.max(1, Math.round(p * market.leverage)));
            }}
          >
            <div className="track" style={{ width: `${(lev / market.leverage) * 100}%` }} />
            <div className="thumb" style={{ left: `${(lev / market.leverage) * 100}%` }} />
          </div>
          <div className="lev-presets">
            {presets
              .filter((p) => p <= market.leverage)
              .map((p) => (
                <button key={p} className={lev === p ? "active" : ""} onClick={() => setLev(p)}>
                  {p}x
                </button>
              ))}
          </div>
        </div>

        {(orderType === "limit" || orderType === "stop") && (
          <div className="field">
            <div className="field-label">
              <span>Price</span>
              <span style={{ color: "var(--ink-3)" }}>Mid {market.price.toFixed(decimals)}</span>
            </div>
            <div className="input-wrap">
              <input type="text" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
              <span className="unit">{market.quote}</span>
            </div>
          </div>
        )}

        <div className="field">
          <div className="field-label">
            <span>Size</span>
            <div className="size-pcts">
              {sizePcts.map((p) => (
                <button key={p}>{p}%</button>
              ))}
            </div>
          </div>
          <div className="input-wrap">
            <input type="text" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value)} />
            <div className="unit-select">
              <span>{market.base}</span>
              <Icon name="chev" size={10} />
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowAdv(!showAdv)}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, color: "var(--ink-3)" }}
        >
          <span
            style={{
              transform: showAdv ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform .15s",
              display: "inline-flex",
            }}
          >
            <Icon name="chev" size={12} />
          </span>
          Take Profit / Stop Loss
        </button>

        {showAdv && (
          <div className="tp-sl">
            <div className="field tp">
              <div className="field-label" style={{ color: "var(--profit-ink)" }}>
                Take Profit
              </div>
              <div className="input-wrap">
                <input type="text" placeholder="0.00" />
                <span className="unit">{market.quote}</span>
              </div>
            </div>
            <div className="field sl">
              <div className="field-label" style={{ color: "var(--loss-ink)" }}>
                Stop Loss
              </div>
              <div className="input-wrap">
                <input type="text" placeholder="0.00" />
                <span className="unit">{market.quote}</span>
              </div>
            </div>
          </div>
        )}

        <div className="options-row">
          <label>
            <input type="checkbox" /> Reduce Only
          </label>
          {orderType === "limit" && (
            <label>
              <input type="checkbox" /> Post Only
            </label>
          )}
        </div>

        <div className="summary">
          <div className="summary-row">
            <span className="l">
              Order Value <Hint w={220}>Notional value of the trade at the entry price.</Hint>
            </span>
            <span className="v mono">{fmtUSD(notional)}</span>
          </div>
          <div className="summary-row">
            <span className="l">
              Required Margin <Hint w={240}>Collateral locked up to open and maintain this position.</Hint>
            </span>
            <span className="v mono">{fmtUSD(reqMargin)}</span>
          </div>
          <div className="summary-row">
            <span className="l">
              Liq. Long <Hint w={260}>If you go long, the price at which you&apos;d be liquidated.</Hint>
            </span>
            <span className="v loss mono">{liqLong.toFixed(decimals)}</span>
          </div>
          <div className="summary-row">
            <span className="l">
              Liq. Short <Hint w={260}>If you go short, the price at which you&apos;d be liquidated.</Hint>
            </span>
            <span className="v loss mono">{liqShort.toFixed(decimals)}</span>
          </div>
          <div className="summary-row">
            <span className="l">
              Est. Fee <Hint w={220}>Trading fee paid on this order (taker rate, 5 bps).</Hint>
            </span>
            <span className="v mono">{fmtUSD(notional * 0.0005)}</span>
          </div>
        </div>
      </div>

      <div className="long-short">
        <button className="long">
          <Icon name="sparkle" size={14} /> Long
        </button>
        <button className="short">
          <Icon name="sparkle" size={14} /> Short
        </button>
      </div>
      <div className="avail-line">
        Available{" "}
        <span className="mono" style={{ color: "var(--ink)", fontWeight: 800 }}>
          {fmtUSD(125420.5)}
        </span>{" "}
        USDC
      </div>
    </div>
  );
}

export function ChartCard({ market }: { market: Market }) {
  const [tf, setTf] = useState("15m");
  const tfs = ["1m", "5m", "15m", "1H", "4H", "1D", "1W"];
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="chart-market">
          <FlagPair a={market.flagA} b={market.flagB} size={26} />
          <div className="chart-price-block">
            <div className="chart-sym-row">
              <span className="chart-sym">{market.sym}</span>
              <span className="pill primary">{market.leverage}x</span>
            </div>
            <div className="chart-price-row">
              <span className="chart-price mono">{market.price.toFixed(decimals)}</span>
              <span
                className="chart-change mono"
                style={{ color: market.change >= 0 ? "var(--profit)" : "var(--loss)" }}
              >
                {fmtPct(market.change)}
              </span>
            </div>
          </div>
        </div>
        <div className="chart-head-right">
          <div className="timeframe-tabs">
            {tfs.map((t) => (
              <button key={t} className={"tf-btn " + (tf === t ? "active" : "")} onClick={() => setTf(t)}>
                {t}
              </button>
            ))}
          </div>
          <button className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="expand" size={14} />
          </button>
        </div>
      </div>
      <div className="chart-substats">
        <div className="chart-stat">
          <span className="l">24h High</span>
          <span className="v mono">{(market.price * 1.012).toFixed(decimals)}</span>
        </div>
        <div className="chart-stat">
          <span className="l">24h Low</span>
          <span className="v mono">{(market.price * 0.988).toFixed(decimals)}</span>
        </div>
        <div className="chart-stat">
          <span className="l">24h Vol</span>
          <span className="v mono">{market.type === "perp" ? "$2.8B" : "$1.4B"}</span>
        </div>
        <div className="chart-stat">
          <span className="l">Spread</span>
          <span className="v mono">{market.spread.toFixed(decimals + 1)}</span>
        </div>
        {market.funding !== undefined && (
          <div className="chart-stat">
            <span className="l">Funding</span>
            <span
              className="v mono"
              style={{ color: market.funding >= 0 ? "var(--profit)" : "var(--loss)" }}
            >
              {(market.funding * 100).toFixed(4)}%
            </span>
          </div>
        )}
        <div className="chart-stat" style={{ marginLeft: "auto" }}>
          <span className="l">Open Interest</span>
          <span className="v mono">$184.2M</span>
        </div>
      </div>
      <CandleChart market={market} timeframe={tf} />
    </div>
  );
}
