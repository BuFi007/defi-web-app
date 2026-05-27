"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useChainId } from "wagmi";
import { formatUnits } from "viem";

import { liquidationPriceFloat, requiredMarginFloat } from "@bufi/perps-math";
import { HUBS } from "@bufi/location/hubs";

import { Icon, fmtUSD, fmtPct, type Market } from "./data";
import { TokenIconPair } from "./token-icon";
import { Hint } from "./hint";
import { CandleChart } from "./chart";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import { useScopedI18n } from "@/locales/client";
import { useIntentStatusStream, useMarkets, usePlaceOrder } from "@/lib/perps/hooks";
import type { PerpsIntentStatus } from "@/lib/perps/client";
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
  const t = useScopedI18n('Panels');
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const { data: markets } = useMarkets(HUBS.arc.chainId);
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
            {t("pendingIntents")}{" "}
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
        <span>{t("price")}</span>
        <span>{t("size")}</span>
        <span>{t("total")}</span>
      </div>
      <div className="ob-rows">
        <div className="ob-half ob-half-asks">
          {asks.length === 0 ? (
            <div className="ob-empty">
              <span className="ob-empty-label mono">
                {isLoading ? "loading…" : t("noPendingShorts")}
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
                {isLoading ? "loading…" : t("noPendingLongs")}
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

const UI_TO_PERP_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  "EUR/USD": ["EURC/USDC"],
  "USD/JPY": ["JPYC/USDC"],
  "USD/MXN": ["MXNB/USDC"],
  "AUD/USD": ["AUDF/USDC"],
  "BTC-PERP": ["CIRBTC/USDC"],
};

// Resolve a user-facing market label (e.g. "EUR/USD") to one of the live
// marketIds returned by /perps/markets. The live ARC universe is currency/
// USDC pairs (EURC/USDC, JPYC/USDC, etc.). Never fall back to an arbitrary
// market: dogfood caught USD/JPY accidentally routing to EURC/USDC when the
// symbol did not line up.
function resolveLiveMarket(uiSym: string, markets: PerpsMarketDto[] | undefined): PerpsMarketDto | undefined {
  if (!markets || markets.length === 0) return undefined;
  const enabled = markets.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : markets;
  const normalized = uiSym.toUpperCase();
  const exactCandidates = UI_TO_PERP_SYMBOLS[normalized] ?? [normalized];
  for (const symbol of exactCandidates) {
    const hit = pool.find((m) => m.symbol.toUpperCase() === symbol);
    if (hit) return hit;
  }
  const [base = "", quote = ""] = normalized.split(/[/-]/);
  const baseAliases: Record<string, string[]> = {
    EUR: ["EURC"],
    JPY: ["JPYC", "TJPYC"],
    MXN: ["MXNB", "TMXNB"],
    BTC: ["CIRBTC"],
    AUD: ["AUDF"],
  };
  const candidates = [
    base,
    ...(baseAliases[base] ?? []),
    quote,
    ...(baseAliases[quote] ?? []),
  ].filter(Boolean);
  for (const c of candidates) {
    const hit = pool.find((m) => m.symbol.toUpperCase().startsWith(c));
    if (hit) return hit;
  }
  return undefined;
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
  const t = useScopedI18n('Panels');
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
  const sideALabel = isSpot ? t("buy") : t("long");
  const sideBLabel = isSpot ? t("sell") : t("short");
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
  const types = [
    { key: "market", label: t("market") },
    { key: "limit", label: t("limit") },
    { key: "stop", label: t("stop") },
    { key: "tp/sl", label: t("takeProfitStopLoss") },
  ];
  const presets = [1, 2, 5, 10, 25, 50, 100];
  const sizePcts = [25, 50, 75, 100];

  const { address, isConnected } = useAccount();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const { toast } = useToast();
  const { data: markets } = useMarkets(HUBS.arc.chainId);
  const placeOrder = usePlaceOrder();
  const liveMarket = useMemo(() => resolveLiveMarket(market.sym, markets), [market.sym, markets]);
  const usdc = useUsdcBalance(address);

  // Step 3: subscribe to the last-submitted intent's status stream so the
  // panel shows live transitions (pending → matched → settled) without a
  // refresh. `lastIntentId` is the DB row id (== the EIP-712 digest used
  // as the perp_order_intents primary key); cleared once we observe a
  // terminal status, so the indicator hides itself.
  const [lastIntentId, setLastIntentId] = useState<string | null>(null);
  const lastStatusRef = useRef<PerpsIntentStatus | null>(null);
  const { intent: liveIntent, status: liveStatus, isTerminal: liveTerminal } =
    useIntentStatusStream(lastIntentId);
  useEffect(() => {
    if (!liveStatus) return;
    const previous = lastStatusRef.current;
    if (previous === liveStatus) return;
    lastStatusRef.current = liveStatus;
    if (previous === null) return; // first observation is the snapshot, not a transition
    if (liveStatus === "filled") {
      toast({ title: "Order settled", description: `Intent ${shortDigest(liveIntent?.intentId ?? "")} → filled on-chain.` });
    } else if (liveStatus === "partially_filled") {
      toast({ title: "Partial fill", description: `Intent ${shortDigest(liveIntent?.intentId ?? "")} — residual still resting.` });
    } else if (liveStatus === "rejected") {
      toast({ variant: "destructive", title: "Order rejected", description: `Intent ${shortDigest(liveIntent?.intentId ?? "")} rejected by the matcher.` });
    } else if (liveStatus === "expired") {
      toast({ variant: "destructive", title: "Order expired", description: `Intent ${shortDigest(liveIntent?.intentId ?? "")} hit its deadline before matching.` });
    }
  }, [liveStatus, liveIntent?.intentId, toast]);
  useEffect(() => {
    if (liveTerminal) {
      // Keep the indicator visible for ~5s after terminal, then clear.
      const t = setTimeout(() => setLastIntentId(null), 5_000);
      return () => clearTimeout(t);
    }
  }, [liveTerminal]);

  // Show a one-time toast when an on-chain identity NFT is minted.
  useEffect(() => {
    const handler = () => {
      if (sessionStorage.getItem("identity-toast-shown")) return;
      sessionStorage.setItem("identity-toast-shown", "1");
      toast({
        title: "Identity minted!",
        description: "Your ERC-8004 trader identity is live. Check the Leaderboard tab.",
      });
    };
    window.addEventListener("identity-registered", handler);
    return () => window.removeEventListener("identity-registered", handler);
  }, [toast]);

  const canTrade = Boolean(isConnected || devWallet);
  const hasSize = sizeV > 0;
  const needsLimitPrice = orderType === "limit" && (!price || parseFloat(price) <= 0);
  const spotUnavailableReason = isSpot
    ? "Spot execution is disabled until the Arc venue route is configured and the spot executor holds inventory."
    : null;
  const submitDisabled =
    !canTrade ||
    !liveMarket ||
    !hasSize ||
    needsLimitPrice ||
    Boolean(spotUnavailableReason) ||
    placeOrder.isPending;

  const submit = async (side: "long" | "short") => {
    if (spotUnavailableReason) {
      toast({
        variant: "destructive",
        title: "Spot unavailable",
        description: spotUnavailableReason,
      });
      return;
    }
    if (!liveMarket) {
      toast({
        variant: "destructive",
        title: t("noMarketAvailable"),
        description: "Live perps markets haven't loaded yet. Retry in a moment.",
      });
      return;
    }
    if (!canTrade) {
      toast({
        variant: "destructive",
        title: t("connectWallet"),
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
        title: t("enterLimitPrice"),
        description: "Limit orders need a non-zero price.",
      });
      return;
    }
    try {
      const result = await placeOrder.mutateAsync({
        marketId: liveMarket.marketId,
        chainId: liveMarket.chainId ?? HUBS.arc.chainId,
        side,
        sizeUsdc: sizeV.toString(),
        leverage: lev,
        orderType: apiKind,
        priceE18: apiKind === "limit" ? priceToE18(price || String(market.price)) : "0",
        reduceOnly,
        postOnly: apiKind === "limit" ? postOnly : false,
      });
      const buyish = side === "long";
      const verb = isSpot ? (buyish ? t("buy") : t("sell")) : (buyish ? t("long") : t("short"));
      toast({
        title: `${verb} submitted`,
        description: `${liveMarket.symbol} · ${apiKind.toUpperCase()} · intent ${shortDigest(result.digest)}`,
      });
      // Subscribe to live status — the SSE hook fires toasts on every
      // transition until the intent reaches a terminal state.
      lastStatusRef.current = null;
      setLastIntentId(result.intent.intentId);
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
          <span>{isSpot ? t("spotOrder") : t("perpOrder")}</span>
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
              {t("cross")}
            </button>
            <button
              className={marginMode === "iso" ? "active" : ""}
              onClick={() => setMarginMode("iso")}
              title="Isolated margin: only the margin you set backs this position. Limits your downside to that amount."
            >
              {t("isolated")}
            </button>
          </div>
        )}
      </div>
      <div className="order-body">
        <div className="order-type-tabs">
          {types.map((ot) => (
            <button
              key={ot.key}
              className={orderType === ot.key ? "active" : ""}
              onClick={() => setOrderType(ot.key)}
            >
              {ot.label}
            </button>
          ))}
        </div>

        <div className="leverage-block">
          <div className="lev-row">
            <span className="field-label" style={{ display: "block" }}>
              {isSpot ? t("mode") : t("leverage")}{" "}
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
              <span className="lev-value">{isSpot ? t("spot") : `${lev}x`}</span>
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
                  {p === 1 ? t("spot") : `${p}x`}
                </button>
              ))}
          </div>
        </div>

        {(orderType === "limit" || orderType === "stop") && (
          <div className="field">
            <div className="field-label">
              <span>{t("fieldPrice")}</span>
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
            <span>{t("fieldSize")}</span>
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
          {t("takeProfitStopLoss")}
        </button>

        {showAdv && (
          <div className="tp-sl">
            <div className="field tp">
              <div className="field-label" style={{ color: "var(--profit-ink)" }}>
                {t("takeProfit")}
              </div>
              <div className="input-wrap">
                <input type="text" placeholder="0.00" />
                <span className="unit">{market.quote}</span>
              </div>
            </div>
            <div className="field sl">
              <div className="field-label" style={{ color: "var(--loss-ink)" }}>
                {t("stopLoss")}
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
            {t("reduceOnly")}
          </label>
          {orderType === "limit" && (
            <label>
              <input
                type="checkbox"
                checked={postOnly}
                onChange={(e) => setPostOnly(e.target.checked)}
              />{" "}
              {t("postOnly")}
            </label>
          )}
        </div>

        <div className="summary">
          <div className="summary-row">
            <span className="l">
              {t("orderValue")} <Hint w={220}>Notional value of the trade at the entry price.</Hint>
            </span>
            <span className="v mono">{fmtUSD(notional)}</span>
          </div>
          {/* Margin + liquidation lines are perps-only — spot trades
              settle atomically and aren't liquidatable. */}
          {!isSpot && (
            <>
              <div className="summary-row">
                <span className="l">
                  {t("requiredMargin")} <Hint w={240}>Collateral locked up to open and maintain this position.</Hint>
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
              {t("estFee")} <Hint w={220}>Trading fee paid on this order (taker rate, 5 bps).</Hint>
            </span>
            <span className="v mono">{fmtUSD(notional * 0.0005)}</span>
          </div>
          {liveMarket && (
            <div className="summary-row" style={{ opacity: 0.7 }}>
              <span className="l">{t("liveMarket")}</span>
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
          title={spotUnavailableReason ?? undefined}
        >
          <Icon name="sparkle" size={14} /> {spotUnavailableReason ? "Spot unavailable" : placeOrder.isPending ? t("signing") : sideALabel}
        </button>
        <button
          className={"short" + (initialSide === "short" ? " primed" : "")}
          disabled={submitDisabled}
          onClick={() => submit("short")}
          aria-busy={placeOrder.isPending}
          data-primed={initialSide === "short" ? "true" : undefined}
          title={spotUnavailableReason ?? undefined}
        >
          <Icon name="sparkle" size={14} /> {spotUnavailableReason ? "Spot unavailable" : placeOrder.isPending ? t("signing") : sideBLabel}
        </button>
      </div>
      {lastIntentId && (
        <div className="intent-status-pill" data-status={liveStatus ?? "pending"}>
          <span className="dot" aria-hidden />
          <span className="label">
            Intent {shortDigest(lastIntentId)} ·{" "}
            <strong>{statusLabel(liveStatus)}</strong>
          </span>
        </div>
      )}
      <div className="avail-line">
        {address ? (
          <>
            {t("available")}{" "}
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
            {t("connectForBalance")}
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
  const t = useScopedI18n('Panels');
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
  const leveragePillLabel = displayLeverage === 1 ? t("spot") : `${displayLeverage}x`;
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
            {tfs.map((tfv) => (
              <button key={tfv} className={"tf-btn " + (tf === tfv ? "active" : "")} onClick={() => setTf(tfv)}>
                {tfv}
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
          <span className="l">{t("high24h")}</span>
          <span className="v mono">{high != null ? high.toFixed(decimals) : "—"}</span>
        </div>
        <div className="chart-stat">
          <span className="l">{t("low24h")}</span>
          <span className="v mono">{low != null ? low.toFixed(decimals) : "—"}</span>
        </div>
        <div className="chart-stat">
          <span className="l">
            {t("vol24h")}{" "}
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

function statusLabel(status: PerpsIntentStatus | undefined): string {
  switch (status) {
    case undefined:
      return "submitting…";
    case "pending":
      return "pending";
    case "partially_filled":
      return "partially filled";
    case "filled":
      return "settled";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
  }
}

function shortAddress(value: string): string {
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
