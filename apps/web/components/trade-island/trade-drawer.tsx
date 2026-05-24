"use client";

/**
 * Dynamic Island TradeDrawer — mobile multi-step order flow.
 *
 * Replaces the legacy "Long / Short opens a full sheet" pattern with
 * a guided wizard:
 *   1. Mode  — Spot (1×) vs Perps leverage
 *   2. Side  — Buy/Sell (spot) OR Long/Short (perps)
 *   3. Size  — Amount + (limit) Price
 *   4. Review — Notional / Margin / Liq / Fee summary
 *   5. Sign  — Submits via usePlaceOrder, shows pending state, dismisses on success
 *
 * Each step animates in/out via `data-step` on the wrapper so CSS can
 * drive the morph (slide + fade). The CTA at the bottom is contextual:
 * "Next" while filling fields, "Sign &amp; submit" on the review step.
 *
 * Drawer chrome (Wave J2):
 *   - Powered by Vaul (`Drawer.Root` / `Portal` / `Overlay` / `Content`).
 *     Vaul owns the swipe-to-dismiss gesture, body scroll lock, focus
 *     trap, and overlay fade. We keep the multi-step layout (progress
 *     dots, back arrow, CTA bar) untouched.
 *   - Drag-to-dismiss is disabled (`dismissible={!isPending}`) while a
 *     tx is in flight so the user can't accidentally swipe away mid
 *     signing prompt.
 *   - We skip Vaul's built-in `<Drawer.Handle>` because the existing
 *     visual handle pill is part of the `td-head` layout; the entire
 *     content surface remains draggable via Vaul's default.
 *
 * Language adapts via the `isSpot` derivation off `lev === 1`:
 *   - Title:  "Place spot order" / "Place perp order"
 *   - Side:   Buy/Sell / Long/Short
 *   - Summary: omits Required Margin + Liq lines in spot mode
 */

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Drawer } from "vaul";

import { liquidationPriceFloat, requiredMarginFloat } from "@bufi/perps-math";

import { Icon, fmtUSD, type Market } from "./data";
import { Hint } from "./hint";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import { useMarkets, usePlaceOrder } from "@/lib/perps/hooks";
import { getPerpsReplacementDevWallet } from "@/lib/perps/dev-mock-wallet";
import type { PerpsMarketDto } from "@/lib/perps/client";

type Step = "mode" | "side" | "size" | "review";
type Side = "long" | "short";

function priceToE18(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return (BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0")).toString();
}

function resolveLiveMarket(
  uiSym: string,
  markets: PerpsMarketDto[] | undefined,
): PerpsMarketDto | undefined {
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

export function TradeDrawer({
  market,
  initialSide,
  onClose,
}: {
  market: Market;
  /** Pre-select Buy/Long or Sell/Short when the user tapped a specific
   *  CTA — skips the side step. */
  initialSide?: Side | null;
  onClose: () => void;
}) {
  // 1× = spot default. The trader can opt into perps by dragging the
  // slider on the mode step; the rest of the flow re-renders to match.
  const [lev, setLev] = useState(1);
  const [side, setSide] = useState<Side | null>(initialSide ?? null);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");

  // Internal open state so Vaul can play its close animation before the
  // parent unmounts us. Parent's `onClose` is called from
  // `onAnimationEnd(false)`, *after* the slide-down has finished.
  const [open, setOpen] = useState(true);

  const isSpot = lev === 1;
  const sideALabel = isSpot ? "Buy" : "Long";
  const sideBLabel = isSpot ? "Sell" : "Short";

  // Skip the side step when a CTA pre-selected it. The slide-direction
  // still feels natural because "mode" → "size" → "review" preserves
  // forward momentum.
  const steps: Step[] = initialSide
    ? ["mode", "size", "review"]
    : ["mode", "side", "size", "review"];
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex] ?? "mode";

  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const sizeV = parseFloat(size) || 0;
  const priceV = parseFloat(price) || market.price;
  const notional = sizeV * priceV;
  const reqMargin = requiredMarginFloat(notional, lev);
  const liqLong = liquidationPriceFloat({
    entryPrice: priceV,
    notionalUsd: notional,
    leverage: lev,
    side: "long",
  });
  const liqShort = liquidationPriceFloat({
    entryPrice: priceV,
    notionalUsd: notional,
    leverage: lev,
    side: "short",
  });

  const { address, isConnected } = useAccount();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const { toast } = useToast();
  const { data: markets } = useMarkets();
  const placeOrder = usePlaceOrder();
  const liveMarket = useMemo(
    () => resolveLiveMarket(market.sym, markets),
    [market.sym, markets],
  );

  const canTrade = Boolean(isConnected || devWallet);
  const hasSize = sizeV > 0;
  const needsLimitPrice = orderType === "limit" && !priceV;

  // Per-step "can I advance" predicate. Drives the CTA enabled state.
  const stepReady = (() => {
    if (step === "mode") return true; // any lev is fine
    if (step === "side") return side !== null;
    if (step === "size") return hasSize && !needsLimitPrice;
    if (step === "review") return canTrade && hasSize && side !== null;
    return false;
  })();

  const requestClose = () => {
    // Don't let the user dismiss mid-signing. Vaul also enforces this
    // via `dismissible`, but we guard the explicit close button too.
    if (placeOrder.isPending) return;
    setOpen(false);
  };

  const advance = () => {
    if (!stepReady) return;
    if (step === "review") {
      void submit();
      return;
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  };
  const back = () => {
    if (stepIndex === 0) return;
    setStepIndex((i) => Math.max(0, i - 1));
  };

  async function submit() {
    if (!liveMarket) {
      toast({
        variant: "destructive",
        title: "No market available",
        description: "Live perps markets haven't loaded yet. Retry in a moment.",
      });
      return;
    }
    if (!canTrade || !side) return;
    try {
      const result = await placeOrder.mutateAsync({
        marketId: liveMarket.marketId,
        side,
        sizeUsdc: sizeV.toString(),
        leverage: lev,
        orderType,
        priceE18: orderType === "limit" ? priceToE18(price || String(market.price)) : "0",
        reduceOnly: false,
        postOnly: false,
      });
      const buyish = side === "long";
      const verb = isSpot ? (buyish ? "Buy" : "Sell") : buyish ? "Long" : "Short";
      toast({
        title: `${verb} submitted`,
        description: `${liveMarket.symbol} · ${orderType.toUpperCase()} · ${result.digest.slice(0, 10)}…`,
      });
      setOpen(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Order failed", description: errMsg(error) });
    }
  }

  const ctaLabel = (() => {
    if (placeOrder.isPending) return "Signing…";
    if (step === "review") {
      if (!canTrade) return "Connect wallet";
      const buyish = side === "long";
      const verb = isSpot ? (buyish ? "Buy" : "Sell") : buyish ? "Long" : "Short";
      return `${verb} ${market.sym}`;
    }
    return "Next";
  })();

  const headerTitle = isSpot ? "Spot order" : "Perp order";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        // Vaul fires this on swipe-down, overlay-tap, ESC. We guard
        // against accidental dismissal while a tx is pending — the
        // `dismissible` prop covers gesture/overlay/ESC, but this
        // double-guards in case Vaul changes behavior.
        if (placeOrder.isPending) return;
        setOpen(false);
      }}
      onAnimationEnd={(isOpen) => {
        // Unmount once the slide-down has finished — keeps the
        // existing parent contract (`orderSide !== null` toggles
        // mount) intact while still letting Vaul play its close anim.
        if (!isOpen) onClose();
      }}
      dismissible={!placeOrder.isPending}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="td-overlay" />
        <Drawer.Content className="td-sheet" data-step={step} aria-label={headerTitle}>
          {/* Vaul requires a Title for a11y. Keep our custom title row
              visible and put the accessible Title in sr-only. */}
          <Drawer.Title className="sr-only">{headerTitle}</Drawer.Title>

          <div className="td-head">
            <button
              className="td-back"
              onClick={back}
              disabled={stepIndex === 0}
              aria-label="Previous step"
            >
              <Icon name="chev_r" size={14} />
            </button>
            <div className="td-handle" aria-hidden />
            <button
              className="td-close"
              onClick={requestClose}
              disabled={placeOrder.isPending}
              aria-label="Close"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>

          <div className="td-progress" role="status" aria-live="polite">
            {steps.map((s, i) => (
              <span
                key={s}
                className={"td-dot " + (i === stepIndex ? "active" : i < stepIndex ? "done" : "")}
              />
            ))}
          </div>

          <div className="td-title-row">
            <div className="td-title">{headerTitle}</div>
            <div className="td-market">
              <span className="td-sym">{market.sym}</span>
              <span className="mono td-price">{market.price.toFixed(decimals)}</span>
            </div>
          </div>

          <div className="td-body" data-vaul-no-drag>
            {step === "mode" && (
              <ModeStep market={market} lev={lev} setLev={setLev} />
            )}
            {step === "side" && (
              <SideStep
                sideALabel={sideALabel}
                sideBLabel={sideBLabel}
                side={side}
                setSide={setSide}
                isSpot={isSpot}
              />
            )}
            {step === "size" && (
              <SizeStep
                market={market}
                size={size}
                setSize={setSize}
                price={price}
                setPrice={setPrice}
                orderType={orderType}
                setOrderType={setOrderType}
                decimals={decimals}
              />
            )}
            {step === "review" && (
              <ReviewStep
                market={market}
                isSpot={isSpot}
                lev={lev}
                side={side}
                sideALabel={sideALabel}
                sideBLabel={sideBLabel}
                orderType={orderType}
                notional={notional}
                reqMargin={reqMargin}
                liqLong={liqLong}
                liqShort={liqShort}
                decimals={decimals}
              />
            )}
          </div>

          <div className="td-foot" data-vaul-no-drag>
            <button
              className={"td-cta " + (side === "short" ? "loss" : "primary")}
              disabled={!stepReady || placeOrder.isPending}
              onClick={advance}
              aria-busy={placeOrder.isPending}
            >
              {ctaLabel}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- step bodies ----------

function ModeStep({
  market,
  lev,
  setLev,
}: {
  market: Market;
  lev: number;
  setLev: (n: number) => void;
}) {
  const isSpot = lev === 1;
  const presets = [1, 2, 5, 10, 25, 50, 100].filter((p) => p <= market.leverage);
  return (
    <div className="td-step">
      <p className="td-step-help">
        {isSpot
          ? "1× = Spot (Buy / Sell directly). Slide to enable perpetuals with leverage."
          : "Higher leverage multiplies both gains and liquidation risk."}{" "}
        <Hint w={260}>
          Spot trades settle atomically with no liquidation. Perps post
          collateral; a small move can liquidate at high leverage.
        </Hint>
      </p>
      <div className="td-mode-value mono">{isSpot ? "Spot" : `${lev}×`}</div>
      <Slider
        value={[lev]}
        min={1}
        max={market.leverage}
        step={1}
        onValueChange={([v]) => setLev(v)}
        aria-label="Mode / Leverage"
      />
      <div className="td-presets">
        {presets.map((p) => (
          <button
            key={p}
            className={lev === p ? "active" : ""}
            onClick={() => setLev(p)}
          >
            {p === 1 ? "Spot" : `${p}×`}
          </button>
        ))}
      </div>
    </div>
  );
}

function SideStep({
  sideALabel,
  sideBLabel,
  side,
  setSide,
  isSpot,
}: {
  sideALabel: string;
  sideBLabel: string;
  side: Side | null;
  setSide: (s: Side) => void;
  isSpot: boolean;
}) {
  return (
    <div className="td-step">
      <p className="td-step-help">
        {isSpot
          ? "Buy adds the base asset; sell converts back to USDC."
          : "Long profits when the price goes up; short profits when it falls."}
      </p>
      <div className="td-side-grid">
        <button
          className={"td-side primary " + (side === "long" ? "active" : "")}
          onClick={() => setSide("long")}
        >
          <Icon name="sparkle" size={16} />
          <span>{sideALabel}</span>
        </button>
        <button
          className={"td-side loss " + (side === "short" ? "active" : "")}
          onClick={() => setSide("short")}
        >
          <Icon name="sparkle" size={16} />
          <span>{sideBLabel}</span>
        </button>
      </div>
    </div>
  );
}

function SizeStep({
  market,
  size,
  setSize,
  price,
  setPrice,
  orderType,
  setOrderType,
  decimals,
}: {
  market: Market;
  size: string;
  setSize: (s: string) => void;
  price: string;
  setPrice: (s: string) => void;
  orderType: "market" | "limit";
  setOrderType: (t: "market" | "limit") => void;
  decimals: number;
}) {
  return (
    <div className="td-step">
      <div className="td-type-tabs">
        <button
          className={orderType === "market" ? "active" : ""}
          onClick={() => setOrderType("market")}
        >
          Market
        </button>
        <button
          className={orderType === "limit" ? "active" : ""}
          onClick={() => setOrderType("limit")}
        >
          Limit
        </button>
      </div>
      {orderType === "limit" && (
        <label className="td-field">
          <span className="td-field-label">Price</span>
          <div className="td-input">
            <input
              type="text"
              inputMode="decimal"
              placeholder={market.price.toFixed(decimals)}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <span className="unit">{market.quote}</span>
          </div>
        </label>
      )}
      <label className="td-field">
        <span className="td-field-label">Size</span>
        <div className="td-input">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            autoFocus
          />
          <span className="unit">{market.base}</span>
        </div>
      </label>
    </div>
  );
}

function ReviewStep({
  market,
  isSpot,
  lev,
  side,
  sideALabel,
  sideBLabel,
  orderType,
  notional,
  reqMargin,
  liqLong,
  liqShort,
  decimals,
}: {
  market: Market;
  isSpot: boolean;
  lev: number;
  side: Side | null;
  sideALabel: string;
  sideBLabel: string;
  orderType: "market" | "limit";
  notional: number;
  reqMargin: number;
  liqLong: number;
  liqShort: number;
  decimals: number;
}) {
  const sideLabel = side === "long" ? sideALabel : side === "short" ? sideBLabel : "—";
  return (
    <div className="td-step">
      <div className="td-summary">
        <div className="td-summary-row">
          <span className="l">Side</span>
          <span className={"v " + (side === "long" ? "profit" : "loss")}>
            {sideLabel}
          </span>
        </div>
        <div className="td-summary-row">
          <span className="l">Mode</span>
          <span className="v">{isSpot ? "Spot" : `${lev}× perps`}</span>
        </div>
        <div className="td-summary-row">
          <span className="l">Order type</span>
          <span className="v">{orderType.toUpperCase()}</span>
        </div>
        <div className="td-summary-row">
          <span className="l">Order value</span>
          <span className="v mono">{fmtUSD(notional)}</span>
        </div>
        {!isSpot && (
          <>
            <div className="td-summary-row">
              <span className="l">Required margin</span>
              <span className="v mono">{fmtUSD(reqMargin)}</span>
            </div>
            {side === "long" && (
              <div className="td-summary-row">
                <span className="l">Liq. price</span>
                <span className="v loss mono">{liqLong.toFixed(decimals)}</span>
              </div>
            )}
            {side === "short" && (
              <div className="td-summary-row">
                <span className="l">Liq. price</span>
                <span className="v loss mono">{liqShort.toFixed(decimals)}</span>
              </div>
            )}
          </>
        )}
        <div className="td-summary-row">
          <span className="l">Est. fee</span>
          <span className="v mono">{fmtUSD(notional * 0.0005)}</span>
        </div>
      </div>
    </div>
  );
}
