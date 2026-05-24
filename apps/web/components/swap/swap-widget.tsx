"use client";

/**
 * <SwapWidget> — Wave-L3 / PR-H9.
 *
 * Spot swap surface that streams quotes from POST /spot/quote (K3) and
 * submits signed fills to POST /spot/fills. Pair selection is the
 * 4-route catalogue we have today (USDC → EURC/JPYC/MXNB/CHFC); the
 * trader signs at the spoke (Fuji) and the venue router persists the
 * intent for downstream FxSwapHook / PoolManager dispatch.
 *
 * State machine:
 *
 *   idle ─(typing)→ quoting ─(200ms+API)→ quoted ─(click)→ signing
 *                                                 ↘                ↘
 *                                                  error            submitting ─→ success
 *                                                                              ↘ error
 *
 * Quote auto-refresh runs 5s before `expiresAt`: we bump a `nonce` ref
 * (so the React Query key changes) and the next render fires a new
 * /spot/quote. If the user is mid-signing when the quote expires we
 * surface "quote expired" and disable the CTA — the user clicks again,
 * we sign against the fresh quote.
 *
 * Vaul styling is shared via the existing `td-*` classes from
 * `apps/web/css/trade-island/island.css` (already imported globally),
 * so the surface visually matches the perp drawer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

import { useToast } from "@/components/ui/use-toast";
import { useEnsureSession } from "@/lib/session";
import { errMsg } from "@/utils";
import {
  freshSpotNonce,
  useSpotQuote,
  useSubmitFill,
  type SpotQuoteResponse,
} from "@/lib/swap/hooks";
import { SPOT_PAIRS, type SpotPair, type SpotPairSymbol } from "@/lib/swap/pairs";

import { SwapPairPicker } from "./pair-picker";
import { QuoteStream } from "./quote-stream";
import { SwapCta, type SwapStatus } from "./swap-cta";

import "./swap-widget.css";

const DEFAULT_PAIR_SYMBOL: SpotPairSymbol = "EURC";
const DEBOUNCE_MS = 300;
const QUOTE_LIFETIME_TTL_GUARD_SEC = 5;
// Slippage tolerance applied to the indicative rate to derive
// `minAmountOut`. K3's `spotIntentRequestSchema` requires a number;
// 0.5% is a sensible default. We expose this in the UI as a hardcoded
// label today and revisit when slippage controls land.
const DEFAULT_SLIPPAGE_BPS = 50;
const DEADLINE_TTL_SEC = 5 * 60;

/**
 * Convert a decimal user-entered string (e.g. "100.5") into the base-unit
 * BigInt string the API expects (e.g. "100500000" for USDC at 6 decimals).
 * Returns "0" for empty / invalid input so the parent can gate on
 * !== "0".
 */
function toBaseUnits(value: string, decimals: number): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return "0";
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (!whole && !frac) return "0";
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const wholeBn = BigInt(whole || "0");
  const fracBn = BigInt(fracPadded || "0");
  return (wholeBn * 10n ** BigInt(decimals) + fracBn).toString();
}

/**
 * Apply slippage tolerance to a base-unit amount-out.
 *   outMin = floor(amountOut * (10_000 - slippageBps) / 10_000)
 */
function applySlippage(amountOut: string, slippageBps: number): string {
  if (amountOut === "0") return "0";
  const out = BigInt(amountOut);
  const numerator = BigInt(10_000 - slippageBps);
  return ((out * numerator) / 10_000n).toString();
}

/** Estimate amountOut from input + pair's indicativeRate. */
function estimateAmountOut(amountInBase: string, pair: SpotPair): string {
  if (amountInBase === "0") return "0";
  // Use floating-point for the rate multiplication, then re-scale to
  // the output token's smallest atomic unit. We're already showing a
  // generous slippage envelope, so the small float error is benign;
  // the on-chain check is the source of truth.
  const rate = pair.indicativeRate;
  if (!Number.isFinite(rate) || rate <= 0) return "0";
  // Move from input base units → display units → estimated output
  // display units → output base units. We can do this in plain JS
  // because amountIn is bounded by the user's wallet.
  const amountInBigInt = BigInt(amountInBase);
  // Output token base decimals (typically 6 for stables).
  // We don't have direct access to that here; the StableToken
  // displayDecimals is for UI rounding, not on-chain decimals. For the
  // 4 stables in scope (EURC, JPYC, MXNB, CHFC) on Arc the on-chain
  // decimals are 6. Encoding that assumption inline with a TODO so the
  // moment a non-6-decimal output lands we'll know to fix it.
  const OUTPUT_DECIMALS = 6;
  // Convert input base → float input (loses precision past ~15 digits,
  // fine for indicative-only display).
  const inputDisplay = Number(amountInBigInt) / 10 ** OUTPUT_DECIMALS;
  const outputDisplay = inputDisplay * rate;
  const outputBase = BigInt(Math.floor(outputDisplay * 10 ** OUTPUT_DECIMALS));
  // Negative guard — Math.floor of a negative would burn through the
  // base unit conversion if we ever multiplied by a negative rate.
  return outputBase < 0n ? "0" : outputBase.toString();
}

export function SwapWidget() {
  // ── inputs ──────────────────────────────────────────────────────────────
  const [pairSymbol, setPairSymbol] = useState<SpotPairSymbol>(DEFAULT_PAIR_SYMBOL);
  const pair = useMemo(
    () => SPOT_PAIRS.find((p) => p.symbol === pairSymbol) ?? SPOT_PAIRS[0]!,
    [pairSymbol],
  );
  const [amount, setAmount] = useState<string>("");

  // Re-issue trigger: bumping this nonce changes the React Query key
  // and forces a fresh /spot/quote. We mint it once per quote-request
  // cycle so the API can dedupe replays.
  const [quoteNonce, setQuoteNonce] = useState<string>(() => freshSpotNonce());
  // Deadline pinned per quote cycle for the same reason.
  const [deadline, setDeadline] = useState<number>(
    () => Math.floor(Date.now() / 1000) + DEADLINE_TTL_SEC,
  );

  // ── wallet ──────────────────────────────────────────────────────────────
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { ensure, isSigning } = useEnsureSession();
  const submit = useSubmitFill();
  const { toast } = useToast();

  // ── derived amounts ─────────────────────────────────────────────────────
  // K3's `/spot/quote` enforces amountIn / minAmountOut as integer strings.
  // We derive them here so the quote hook receives stable values.
  const inputBase = useMemo(
    () => toBaseUnits(amount, 6 /* USDC on Fuji has 6 decimals */),
    [amount],
  );
  const estimatedOut = useMemo(() => estimateAmountOut(inputBase, pair), [inputBase, pair]);
  const minAmountOut = useMemo(
    () => applySlippage(estimatedOut, DEFAULT_SLIPPAGE_BPS),
    [estimatedOut],
  );

  // ── debounce gate for the quote query ───────────────────────────────────
  // We delay the React Query trigger by DEBOUNCE_MS after the last
  // input change so we don't fire a quote on every keystroke. The
  // delayed-amount is the only thing we pass to `useSpotQuote`.
  const [debouncedAmount, setDebouncedAmount] = useState(inputBase);
  useEffect(() => {
    if (inputBase === debouncedAmount) return;
    const id = setTimeout(() => setDebouncedAmount(inputBase), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [inputBase, debouncedAmount]);

  // Reset quote-side state when the pair changes — the typed-data domain
  // depends on the symbol, so a stale signature against an old pair would
  // never recover. Bumping the nonce mints a fresh quote.
  const lastPairRef = useRef<SpotPairSymbol>(pairSymbol);
  useEffect(() => {
    if (lastPairRef.current === pairSymbol) return;
    lastPairRef.current = pairSymbol;
    setQuoteNonce(freshSpotNonce());
    setDeadline(Math.floor(Date.now() / 1000) + DEADLINE_TTL_SEC);
  }, [pairSymbol]);

  const quoteArgs = useMemo(() => {
    if (!isConnected || !address) return null;
    if (!debouncedAmount || debouncedAmount === "0") return null;
    if (!minAmountOut) return null;
    return {
      pair,
      trader: address as `0x${string}`,
      amountIn: debouncedAmount,
      minAmountOut,
      deadline,
      nonce: quoteNonce,
    };
  }, [pair, isConnected, address, debouncedAmount, minAmountOut, deadline, quoteNonce]);

  const quoteQuery = useSpotQuote(quoteArgs);
  const quote: SpotQuoteResponse | undefined = quoteQuery.data;
  const quoteError = quoteQuery.error ? errMsg(quoteQuery.error) : null;

  // 1Hz ticker so the CTA gating + disabled-reason copy can react to
  // quote expiry without violating React's "no impure calls during
  // render" rule. The QuoteStream component owns its own ticker for the
  // countdown UI; this one only feeds the gating predicates below.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [quote]);

  // ── TTL refresh ─────────────────────────────────────────────────────────
  // 5s before expiry, kick a fresh quote so the user always has time to
  // sign + submit. This only fires while the widget is mounted AND
  // there's an existing quote — once a fill is in-flight we don't want
  // the quote to swap out under us.
  useEffect(() => {
    if (!quote) return;
    if (submit.isPending) return; // freeze refresh during signing/submit
    const remaining = quote.expiresAt - Math.floor(Date.now() / 1000);
    if (remaining <= 0) return;
    const refreshIn = Math.max(0, remaining - QUOTE_LIFETIME_TTL_GUARD_SEC) * 1000;
    const id = setTimeout(() => {
      setQuoteNonce(freshSpotNonce());
      setDeadline(Math.floor(Date.now() / 1000) + DEADLINE_TTL_SEC);
    }, refreshIn);
    return () => clearTimeout(id);
  }, [quote, submit.isPending]);

  // ── derived status for the CTA + presentation layer ─────────────────────
  const status: SwapStatus = useMemo(() => {
    if (submit.isSuccess) return "success";
    if (submit.isPending) return "submitting";
    if (isSigning) return "signing";
    if (submit.isError) return "error";
    if (quoteError) return "error";
    if (quoteQuery.isFetching && !quote) return "quoting";
    if (quote) return "quoted";
    return "idle";
  }, [submit.isSuccess, submit.isPending, submit.isError, isSigning, quote, quoteError, quoteQuery.isFetching]);

  // ── CTA gating ──────────────────────────────────────────────────────────
  const wrongChain = isConnected && chainId !== pair.sourceChainId;
  const disabledReason: string | null = (() => {
    if (!isConnected) return "Connect a wallet to continue.";
    if (wrongChain)
      return `Switch to ${pair.sourceChainId === 43113 ? "Avalanche Fuji" : "the source chain"} to sign this swap.`;
    if (!amount || inputBase === "0") return null; // idle, no reason needed
    if (!quote) return null; // still fetching; CTA reads "Fetching quote…"
    const remaining = quote.expiresAt - nowSec;
    if (remaining <= 0) return "Quote expired — refresh to continue.";
    return null;
  })();

  const ctaDisabled =
    status === "submitting" ||
    status === "signing" ||
    !isConnected ||
    wrongChain ||
    !quote ||
    quote.expiresAt - nowSec <= 0;

  // ── submit handler ──────────────────────────────────────────────────────
  const onSubmit = useCallback(async () => {
    if (!quote || !address || !isConnected) return;
    if (wrongChain) {
      try {
        await switchChain({ chainId: pair.sourceChainId });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't switch chain",
          description: errMsg(err),
        });
      }
      return;
    }
    try {
      // EnsureSession reuses a cached proof or signs a fresh one — same
      // session the perps surface uses, so logging in once unlocks both.
      const session = await ensure("swap.fill");
      const result = await submit.mutateAsync({
        quote,
        trader: address as `0x${string}`,
        session,
      });
      if (result.fill.status === "rejected") {
        toast({
          variant: "destructive",
          title: "Fill rejected",
          description: result.fill.reason ?? "Venue router rejected the fill.",
        });
      } else {
        toast({
          title: "Swap submitted",
          description: `Fill ${result.fill.fillId.slice(0, 14)}… accepted.`,
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Swap failed",
        description: errMsg(error),
      });
    }
  }, [quote, address, isConnected, wrongChain, switchChain, pair.sourceChainId, ensure, submit, toast]);

  // ── render ──────────────────────────────────────────────────────────────
  const submitErrorMsg = submit.error ? errMsg(submit.error) : quoteError;

  return (
    <section className="swap-widget" aria-label="Spot swap">
      <header className="swap-widget-head">
        <h1 className="swap-widget-title">Swap</h1>
        <p className="swap-widget-subtitle">
          USDC on Fuji into stables on Arc — quotes via BUFX venue router, settled
          through the FX Telaraña pool.
        </p>
      </header>

      <SwapPairPicker
        value={pair.symbol}
        onChange={(next) => {
          setPairSymbol(next.symbol);
          // Clear any prior fill result so the success card doesn't
          // linger across pair changes.
          submit.reset();
        }}
        disabled={status === "signing" || status === "submitting" || isSwitchingChain}
      />

      <label className="swap-amount-field" htmlFor="swap-amount-in">
        <span className="swap-amount-label">
          You pay <span className="mono">{pair.inputToken.asset}</span>
        </span>
        <div className="swap-amount-input-wrap">
          <input
            id="swap-amount-in"
            className="swap-amount-input mono"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "" || /^\d*(\.\d*)?$/.test(next)) {
                setAmount(next);
                // Reset the in-flight quote nonce so we don't reuse one
                // for a different amount — but only when the user is
                // actively editing, not when we set up the initial value.
                if (!submit.isPending && !isSigning) {
                  setQuoteNonce(freshSpotNonce());
                  setDeadline(Math.floor(Date.now() / 1000) + DEADLINE_TTL_SEC);
                  submit.reset();
                }
              }
            }}
            disabled={status === "signing" || status === "submitting"}
            aria-describedby="swap-amount-receive"
          />
          <span className="swap-amount-unit">{pair.inputToken.asset}</span>
        </div>
      </label>

      <div className="swap-amount-receive" id="swap-amount-receive">
        <span>You receive</span>
        <span className="mono">
          ≈{" "}
          {estimatedOut === "0"
            ? "—"
            : (Number(estimatedOut) / 10 ** 6).toFixed(pair.outputToken.displayDecimals)}{" "}
          {pair.outputToken.asset}
        </span>
      </div>

      <QuoteStream
        pair={pair}
        quote={quote}
        isFetching={quoteQuery.isFetching}
        error={quoteError}
        minAmountOut={
          minAmountOut === "0"
            ? undefined
            : (Number(minAmountOut) / 10 ** 6).toFixed(pair.outputToken.displayDecimals)
        }
      />

      <SwapCta
        status={status}
        pair={pair}
        disabled={ctaDisabled}
        disabledReason={disabledReason ?? undefined}
        fill={submit.data?.fill ?? null}
        errorMessage={submitErrorMsg}
        onSubmit={onSubmit}
      />

      <footer className="swap-widget-footnote">
        Slippage {(DEFAULT_SLIPPAGE_BPS / 100).toFixed(2)}% · Deadline{" "}
        {Math.round(DEADLINE_TTL_SEC / 60)}m · Source Fuji → Hub Arc
      </footer>
    </section>
  );
}
