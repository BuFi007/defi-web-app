"use client";

import { useMemo, useState } from "react";
import { useAccount, useBalance, useChainId } from "wagmi";
import { formatUnits } from "viem";

import { liquidationPriceFloat, requiredMarginFloat } from "@bufi/perps-math";

import { Icon, fmtUSD, fmtPct, type Market } from "./data";
import { TokenIconPair } from "./token-icon";
import { Hint } from "./hint";
import { CandleChart } from "./chart";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import { useMarkets, usePlaceOrder } from "@/lib/perps/hooks";
import { useMarketStats } from "@/lib/perps/use-market-stats";
import { usePendingIntents } from "@/lib/perps/use-pending-intents";
import { getPerpsReplacementDevWallet } from "@/lib/perps/dev-mock-wallet";
import type { PerpsMarketDto } from "@/lib/perps/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

// USDC token addresses per hub chain — perps margin is posted in USDC.
// Spokes are excluded here because perps execution lives on the hubs.
const USDC_BY_CHAIN: Record<number, `0x${string}`> = {
  43113: "0x5425890298aed601595a70AB815c96711a31Bc65", // Fuji
  5042002: "0x3600000000000000000000000000000000000000", // Arc
};

function useUsdcBalance(address: `0x${string}` | undefined): {
  formatted: string;
  isLoading: boolean;
} {
  const chainId = useChainId();
  const token = USDC_BY_CHAIN[chainId];
  const { data, isLoading } = useBalance({
    address,
    token,
    chainId: (token ? chainId : undefined) as 43113 | 5042002 | undefined,
    query: { enabled: Boolean(address && token) },
  });
  if (!data) return { formatted: "0", isLoading };
  return {
    formatted: formatUnits(data.value, data.decimals ?? 6),
    isLoading,
  };
}

// Replaces the legacy fake CLOB. This system uses a price-time matcher
// (apps/keeper-perps-matcher), not a resting-order book — what we show
// here is the matcher's pending-intent queue grouped by limit price.
// Bids = pending longs waiting to be matched. Asks = pending shorts.
export function OrderbookCard({ market }: { market: Market }) {
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const { data: markets } = useMarkets();
  const liveMarket = useMemo(
    () => resolveLiveMarket(market.sym, markets),
    [market.sym, markets],
  );
  const { data: book, isLoading } = usePendingIntents(liveMarket?.marketId, 10);
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const mid = book?.mid ?? market.price;
  const spread =
    bids.length > 0 && asks.length > 0 ? asks[0].price - bids[0].price : null;
  const spreadPct = spread != null && mid > 0 ? (spread / mid) * 100 : null;
  const maxTotal = book?.maxTotal ?? 1;

  return (
    <div className="card orderbook-card">
      <div className="card-head ob-head">
        <div className="card-title">
          <span>
            Pending Intents{" "}
            <Hint w={300}>
              This is not a traditional order book — it&apos;s the
              price-time matcher&apos;s pending-intent queue. Bids =
              pending longs waiting to be matched. Asks = pending shorts.
              Counts collapse multiple intents at the same price level.
            </Hint>
          </span>
        </div>
        <span
          className="pill muted"
          title="Total pending intents on this market"
        >
          {book?.totalPending ?? 0}
        </span>
      </div>
      <div className="ob-cols">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div className="ob-rows">
        <div className="ob-half ob-half-asks">
          {asks.length === 0 ? (
            <div className="ob-empty">
              <span className="ob-empty-label mono">
                {isLoading ? "loading…" : "no pending shorts"}
              </span>
            </div>
          ) : (
            // Asks render closest-to-spread first visually (lowest ask
            // touches the spread line). flex-direction column-reverse
            // gives us that without re-sorting the array.
            [...asks].map((a, i) => (
              <div key={"a" + i} className="ob-row ask">
                <div
                  className="bar"
                  style={{ width: `${(a.total / maxTotal) * 100}%` }}
                />
                <span className="v price mono">{a.price.toFixed(decimals)}</span>
                <span className="v size mono">{a.size.toFixed(2)}</span>
                <span className="v total mono">{a.total.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
        <div className="ob-spread">
          <span className="last mono">
            {mid.toFixed(decimals)}
            <span
              style={{
                color: market.change >= 0 ? "var(--profit-ink)" : "var(--loss-ink)",
              }}
            >
              {market.change >= 0 ? "↑" : "↓"}
            </span>
          </span>
          <span className="meta">
            {spread != null && spreadPct != null
              ? `Spread ${spread.toFixed(decimals + 1)} (${spreadPct.toFixed(3)}%)`
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
                <div
                  className="bar"
                  style={{ width: `${(b.total / maxTotal) * 100}%` }}
                />
                <span className="v price mono">{b.price.toFixed(decimals)}</span>
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

// Resolve a user-facing market label (e.g. "EUR/USD") to one of the live
// marketIds returned by /perps/markets. The live ARC universe is currency/
// USDC pairs (EURC/USDC, tJPYC/USDC, etc.) so we match on the base currency.
// Falls back to the first enabled market so the UI still produces a signed
// intent during E2E even when symbols don't line up perfectly.
function resolveLiveMarket(uiSym: string, markets: PerpsMarketDto[] | undefined): PerpsMarketDto | undefined {
  if (!markets || markets.length === 0) return undefined;
  const enabled = markets.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : markets;
  const base = uiSym.split(/[/-]/)[0]?.toUpperCase() ?? "";
  const baseAliases: Record<string, string[]> = {
    EUR: ["EURC"],
    JPY: ["JPYC", "TJPYC"],
    MXN: ["MXNB", "TMXNB"],
    CHF: ["CHFC", "TCHFC"],
  };
  const candidates = [base, ...(baseAliases[base] ?? [])];
  for (const c of candidates) {
    const hit = pool.find((m) => m.symbol.toUpperCase().startsWith(c));
    if (hit) return hit;
  }
  return pool[0];
}

export function OrderPanelCard({
  market,
  initialSide,
  leverage: externalLeverage,
  setLeverage: setExternalLeverage,
}: {
  market: Market;
  /** Mobile bottom-sheet pre-selects which side the trader tapped on the sticky CTAs. */
  initialSide?: "long" | "short";
  /** When provided, leverage is controlled by the parent (lifted state
   *  so the ChartCard pill stays in sync). When omitted, falls back to
   *  local state — the mobile bottom-sheet path doesn't lift. */
  leverage?: number;
  setLeverage?: (n: number) => void;
}) {
  const [orderType, setOrderType] = useState("limit");
  const [marginMode, setMarginMode] = useState("cross");
  // Default = 1x spot. See TradeTab; this internal fallback only kicks
  // in for standalone uses (mobile sheet) where state isn't lifted.
  const [internalLev, setInternalLev] = useState(1);
  const lev = externalLeverage ?? internalLev;
  const setLev = setExternalLeverage ?? setInternalLev;
  // Mode pivot. 1x = spot (Buy / Sell labels, no margin tabs, no liq
  // lines, no funding). >1x = perps (Long / Short labels + the
  // leverage-aware machinery). Single derived flag keeps the rendering
  // branches honest — no place can drift out of sync.
  const isSpot = lev === 1;
  const sideALabel = isSpot ? "Buy" : "Long";
  const sideBLabel = isSpot ? "Sell" : "Short";
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const sizeV = parseFloat(size) || 0;
  const priceV = parseFloat(price) || market.price;
  const notional = sizeV * priceV;
  // Margin + liq price now go through @bufi/perps-math (bigint internally).
  // Semantics preserved: reqMargin = notional/lev; liq = price * (1 ∓ 0.8/lev).
  const reqMargin = requiredMarginFloat(notional, lev);
  const liqLong = liquidationPriceFloat({ entryPrice: priceV, notionalUsd: notional, leverage: lev, side: "long" });
  const liqShort = liquidationPriceFloat({ entryPrice: priceV, notionalUsd: notional, leverage: lev, side: "short" });
  const types = ["Market", "Limit", "Stop", "TP/SL"];
  const presets = [1, 2, 5, 10, 25, 50, 100];
  const sizePcts = [25, 50, 75, 100];

  const { address, isConnected } = useAccount();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const { toast } = useToast();
  const { data: markets } = useMarkets();
  const placeOrder = usePlaceOrder();
  const liveMarket = useMemo(() => resolveLiveMarket(market.sym, markets), [market.sym, markets]);
  const usdc = useUsdcBalance(address);

  const canTrade = Boolean(isConnected || devWallet);
  const hasSize = sizeV > 0;
  const needsLimitPrice = orderType === "limit" && (!price || parseFloat(price) <= 0);
  const submitDisabled = !canTrade || !liveMarket || !hasSize || needsLimitPrice || placeOrder.isPending;

  const submit = async (side: "long" | "short") => {
    if (!liveMarket) {
      toast({
        variant: "destructive",
        title: "No market available",
        description: "Live perps markets haven't loaded yet. Retry in a moment.",
      });
      return;
    }
    if (!canTrade) {
      toast({
        variant: "destructive",
        title: "Connect a wallet",
        description: "Connect your wallet (or set NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1 for dev).",
      });
      return;
    }
    if (!hasSize) {
      toast({ variant: "destructive", title: "Enter a size", description: "Size must be greater than zero." });
      return;
    }
    const apiKind: "limit" | "market" = orderType === "market" ? "market" : "limit";
    if (apiKind === "limit" && (!price || parseFloat(price) <= 0)) {
      toast({
        variant: "destructive",
        title: "Enter a limit price",
        description: "Limit orders need a non-zero price.",
      });
      return;
    }
    try {
      const result = await placeOrder.mutateAsync({
        marketId: liveMarket.marketId,
        side,
        sizeUsdc: sizeV.toString(),
        leverage: lev,
        orderType: apiKind,
        priceE18: apiKind === "limit" ? priceToE18(price || String(market.price)) : "0",
        reduceOnly,
        postOnly: apiKind === "limit" ? postOnly : false,
      });
      const buyish = side === "long";
      const verb = isSpot ? (buyish ? "Buy" : "Sell") : (buyish ? "Long" : "Short");
      toast({
        title: `${verb} submitted`,
        description: `${liveMarket.symbol} · ${apiKind.toUpperCase()} · intent ${shortDigest(result.digest)}`,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Order failed", description: errMsg(error) });
    }
  };

  return (
    <div className="card order-card">
      <div className="order-head">
        <div className="card-title">
          <span className="card-icon">
            <Icon name="bolt" size={15} />
          </span>
          <span>{isSpot ? "Spot Order" : "Perp Order"}</span>
        </div>
        {/* Margin-mode tabs are perps-only — spot trades don't post
            collateral so Cross/Isolated has no meaning. */}
        {!isSpot && (
          <div className="margin-tabs">
            <button
              className={marginMode === "cross" ? "active" : ""}
              onClick={() => setMarginMode("cross")}
              title="Cross margin: all your free collateral backs every position. Lower liquidation risk but losses can cascade."
            >
              Cross
            </button>
            <button
              className={marginMode === "iso" ? "active" : ""}
              onClick={() => setMarginMode("iso")}
              title="Isolated margin: only the margin you set backs this position. Limits your downside to that amount."
            >
              Isolated
            </button>
          </div>
        )}
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
              {isSpot ? "Mode" : "Leverage"}{" "}
              <Hint w={280}>
                {isSpot
                  ? "1× = Spot mode (Buy / Sell directly). Drag past 1× to enable perpetuals with leverage."
                  : "Multiplies your buying power. Higher leverage = smaller move can liquidate you."}
              </Hint>
            </span>
            <div className="lev-control">
              <button onClick={() => setLev(Math.max(1, lev - 1))}>
                <Icon name="minus" size={12} />
              </button>
              <span className="lev-value">{isSpot ? "Spot" : `${lev}x`}</span>
              <button onClick={() => setLev(Math.min(market.leverage, lev + 1))}>
                <Icon name="plus" size={12} />
              </button>
            </div>
          </div>
          <Slider
            value={[lev]}
            min={1}
            max={market.leverage}
            step={1}
            onValueChange={([v]) => setLev(v)}
            aria-label={isSpot ? "Mode" : "Leverage"}
            className="my-2"
          />
          <div className="lev-presets">
            {presets
              .filter((p) => p <= market.leverage)
              .map((p) => (
                <button key={p} className={lev === p ? "active" : ""} onClick={() => setLev(p)}>
                  {p === 1 ? "Spot" : `${p}x`}
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
            <input
              type="checkbox"
              checked={reduceOnly}
              onChange={(e) => setReduceOnly(e.target.checked)}
            />{" "}
            Reduce Only
          </label>
          {orderType === "limit" && (
            <label>
              <input
                type="checkbox"
                checked={postOnly}
                onChange={(e) => setPostOnly(e.target.checked)}
              />{" "}
              Post Only
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
          {/* Margin + liquidation lines are perps-only — spot trades
              settle atomically and aren't liquidatable. */}
          {!isSpot && (
            <>
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
            </>
          )}
          <div className="summary-row">
            <span className="l">
              Est. Fee <Hint w={220}>Trading fee paid on this order (taker rate, 5 bps).</Hint>
            </span>
            <span className="v mono">{fmtUSD(notional * 0.0005)}</span>
          </div>
          {liveMarket && (
            <div className="summary-row" style={{ opacity: 0.7 }}>
              <span className="l">Live market</span>
              <span className="v mono" style={{ fontSize: 11 }}>
                {liveMarket.symbol}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="long-short">
        <button
          className={"long" + (initialSide === "long" ? " primed" : "")}
          disabled={submitDisabled}
          onClick={() => submit("long")}
          aria-busy={placeOrder.isPending}
          data-primed={initialSide === "long" ? "true" : undefined}
        >
          <Icon name="sparkle" size={14} /> {placeOrder.isPending ? "Signing..." : sideALabel}
        </button>
        <button
          className={"short" + (initialSide === "short" ? " primed" : "")}
          disabled={submitDisabled}
          onClick={() => submit("short")}
          aria-busy={placeOrder.isPending}
          data-primed={initialSide === "short" ? "true" : undefined}
        >
          <Icon name="sparkle" size={14} /> {placeOrder.isPending ? "Signing..." : sideBLabel}
        </button>
      </div>
      <div className="avail-line">
        {address ? (
          <>
            Available{" "}
            <span className="mono" style={{ color: "var(--ink)", fontWeight: 800 }}>
              {usdc.isLoading ? "…" : fmtUSD(Number(usdc.formatted))}
            </span>{" "}
            USDC ·{" "}
            <span className="mono" style={{ color: "var(--muted)" }}>
              {shortAddress(address)}
            </span>
          </>
        ) : (
          <span className="mono" style={{ color: "var(--muted)" }}>
            Connect a wallet to see your USDC balance.
          </span>
        )}
      </div>
    </div>
  );
}

export function ChartCard({
  market,
  selectedLeverage,
}: {
  market: Market;
  /** Trader-selected leverage from the OrderPanelCard slider. The pill
   *  in the chart header reflects this in real-time so the user sees
   *  the leverage they're about to trade at, not the market's hard cap. */
  selectedLeverage?: number;
}) {
  const [tf, setTf] = useState("15m");
  const [expanded, setExpanded] = useState(false);
  // 1W intentionally dropped: Pyth Benchmarks enforces a 1-year
  // max-range on FX queries, so the weekly bar count is too sparse
  // to render usefully. Reinstate once the data source supports
  // multi-year weekly history.
  const tfs = ["1m", "5m", "15m", "1H", "4H", "1D"];
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const { data: stats } = useMarketStats(market.sym);
  const high = stats?.high ?? null;
  const low = stats?.low ?? null;
  const vol = stats?.volume ?? null;
  const changePct = stats?.changePct ?? market.change;
  // Display the trader's actual chosen leverage when the panel lifted
  // state into us; otherwise fall back to the market's hard ceiling so
  // standalone uses (mobile, embed) still render something sensible.
  // Default to 1x (Spot) when the trader hasn't lifted a leverage —
  // matches OrderPanelCard's new spot-first default. The pill renders
  // "Spot" at 1x, "Nx" otherwise.
  const displayLeverage = selectedLeverage ?? 1;
  const leveragePillLabel = displayLeverage === 1 ? "Spot" : `${displayLeverage}x`;
  const headerInner = (
    <>
      <div className="chart-head">
        <div className="chart-market">
          <TokenIconPair base={market.base} quote={market.quote} size={26} />
          <div className="chart-price-block">
            <div className="chart-sym-row">
              <span className="chart-sym">{market.sym}</span>
              <span className="pill primary">{leveragePillLabel}</span>
            </div>
            <div className="chart-price-row">
              <span className="chart-price mono">
                {market.price > 0 ? market.price.toFixed(decimals) : "—"}
              </span>
              {market.price > 0 && (
                <span
                  className="chart-change mono"
                  style={{ color: changePct >= 0 ? "var(--profit)" : "var(--loss)" }}
                >
                  {fmtPct(changePct)}
                </span>
              )}
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
          <button
            type="button"
            className="icon-btn"
            style={{ width: 34, height: 34, borderRadius: 10 }}
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse chart" : "Open full-screen chart"}
            aria-label={expanded ? "Collapse chart" : "Open full-screen chart"}
          >
            <Icon name="expand" size={14} />
          </button>
        </div>
      </div>
      <div className="chart-substats">
        <div className="chart-stat">
          <span className="l">24h High</span>
          <span className="v mono">{high != null ? high.toFixed(decimals) : "—"}</span>
        </div>
        <div className="chart-stat">
          <span className="l">24h Low</span>
          <span className="v mono">{low != null ? low.toFixed(decimals) : "—"}</span>
        </div>
        <div className="chart-stat">
          <span className="l">
            24h Vol{" "}
            <Hint w={240}>
              FX feeds don&apos;t carry traded volume — the bar is a proxy
              derived from per-bar price-change magnitude.
            </Hint>
          </span>
          <span className="v mono">
            {vol != null && Number.isFinite(vol) ? fmtUSD(vol) : "—"}
          </span>
        </div>
      </div>
    </>
  );
  return (
    <>
      <div className="card chart-card">
        {headerInner}
        <CandleChart market={market} timeframe={tf} source="ponder" liveSource="ws" />
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent size="full" className="p-0 h-[90vh] flex flex-col">
          <DialogTitle className="sr-only">{market.sym} chart</DialogTitle>
          <div className="card chart-card" style={{ height: "100%", border: 0, boxShadow: "none" }}>
            {headerInner}
            <CandleChart market={market} timeframe={tf} source="ponder" liveSource="ws" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 1e18-scale a decimal price string without dragging in viem/parseUnits here.
function priceToE18(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return (BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0")).toString();
}

function shortDigest(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function shortAddress(value: string): string {
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

