"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useBalance } from "wagmi";
import { formatUnits, type Address } from "viem";
import { AnimatePresence, motion } from "framer-motion";
import type { WagmiChainId } from "@/utils/chain";
import { ChainSelect } from "@/components/chain-select";
import { TokenChip } from "@/components/token-chip";
import { AnimatedNumber } from "@/components/animated-number";
import { useMarkets as useTelaranaMarkets } from "@/lib/telarana/hooks";
import {
  STABLE_TOKEN_LIST,
  type StableTokenType,
} from "@bufi/location/stable-tokens";
import type { Token } from "@/lib/types";
import { useI18n } from "@/locales/client";

import { SPOKE_CHAINS, type SpokeChain } from "./deployments";

const TOKEN_META = Object.fromEntries(
  STABLE_TOKEN_LIST.map((t) => [t.asset, t] as const),
) as Record<StableTokenType, (typeof STABLE_TOKEN_LIST)[number]>;

const iconSrc = (icon: (typeof STABLE_TOKEN_LIST)[number]["icon"]): string =>
  typeof icon === "string" ? icon : icon.src;

// USD price now lives on `StableToken.usdPrice` in @bufi/location —
// single source of truth for the wallet trigger total AND the loan
// ActionCard projection. Replaced the local TOKEN_USD_PRICE table.

const toToken = (
  cfg: SpokeChain,
  asset: StableTokenType,
  address: Address | null,
  decimals: number,
): Token => {
  const meta = TOKEN_META[asset];
  return {
    // TokenChip only checks for the native sentinel; ERC-20 stables can
    // safely carry the deployed address or a placeholder when Pending.
    address: address ?? "0x",
    chainId: cfg.chainId as NonNullable<WagmiChainId>,
    decimals,
    symbol: asset,
    name: meta.name,
    image: iconSrc(meta.icon),
  };
};

interface ChainBalanceRow {
  asset: StableTokenType;
  address: Address | null;
  decimals: number;
  /** Human-decimal balance, e.g. "12.45". "0" when zero or unknown. */
  formatted: string;
  /** Float for sort + USD conversion math. NaN if not known. */
  balance: number;
  /** Face-value in USD via StableToken.usdPrice. 0 when no deployment. */
  usdValue: number;
  deployed: boolean;
  isLoading: boolean;
}

// Read every stablecoin balance on EVERY configured spoke chain in fixed
// order so the hook count stays stable across renders. Returns a
// chainId → rows map; the caller picks the active chain's rows for the
// popover list and sums every chain's rows for the trigger pill (which
// surfaces the USDC-equivalent TOTAL across all chains AND all stables,
// not just USDC face value on one chain).
const useAllChainsStableBalances = (
  walletAddress: Address | undefined,
): Record<number, ChainBalanceRow[]> => {
  // Flat double-loop: SPOKE_CHAINS × STABLE_TOKEN_LIST. Both lists are
  // module-level constants, so the iteration order is identical render
  // to render — the hook-count invariant is satisfied even though we
  // call `useBalance` from inside a nested map.
  const entries = SPOKE_CHAINS.map((cfg) => {
    const rows = STABLE_TOKEN_LIST.map((t): ChainBalanceRow => {
      const deployment = cfg.tokens.find((d) => d.asset === t.asset);
      const decimals = deployment?.decimals ?? 6;
      const address = (deployment?.address ?? null) as Address | null;
      const enabled = Boolean(cfg.isWagmiSupported && address && walletAddress);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const bal = useBalance({
        address: walletAddress,
        token: (address ?? undefined) as Address | undefined,
        chainId: cfg.chainId as NonNullable<WagmiChainId>,
        query: { enabled },
      });
      const formatted = bal.data ? formatUnits(bal.data.value, decimals) : "0";
      const balance = bal.data ? Number(formatted) : 0;
      const price = t.usdPrice ?? 0;
      const usdValue =
        Number.isFinite(balance) && address ? balance * price : 0;
      return {
        asset: t.asset,
        address,
        decimals,
        formatted,
        balance,
        usdValue,
        deployed: Boolean(address),
        isLoading: Boolean(bal.isLoading),
      };
    });
    return [cfg.chainId, rows] as const;
  });
  // Memoize by stringified content so the returned object identity is
  // stable across renders unless an underlying balance / price actually
  // changes. Without this, every wagmi subscription tick produced a new
  // map → every downstream useMemo recomputed → AnimatePresence
  // reconciled its children with the new identity → in some chain-switch
  // sequences React hit "Too many re-renders" before the page loaded.
  //
  // The key intentionally hashes only `formatted` per (chainId, asset) —
  // that's the on-chain truth. usdValue derives from it, isLoading is
  // a transient flag, decimals/address/deployed are constants per chain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableKey = entries
    .map(([cid, rows]) => `${cid}:${rows.map((r) => `${r.asset}=${r.formatted}`).join(",")}`)
    .join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(entries), [stableKey]);
};

// One row = inline render. Stateless — all data comes from the parent's
// useChainStableBalances pass so the parent owns sort order + totals.
const TokenBalanceRow: React.FC<{
  cfg: SpokeChain;
  row: ChainBalanceRow;
}> = ({ cfg, row }) => {
  const tokenForChip = toToken(cfg, row.asset, row.address, row.decimals);
  return (
    <li className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <TokenChip token={tokenForChip} chain={cfg.chain} />
      {row.deployed ? (
        row.isLoading ? (
          <span className="text-[11px] font-bold text-zinc-400 mono">…</span>
        ) : (
          <span className="text-[12px] font-bold text-zinc-700 dark:text-zinc-200 mono tabular-nums">
            <AnimatedNumber
              value={row.balance}
              currency={null}
              maximumFractionDigits={row.balance >= 1 ? 2 : 4}
              minimumFractionDigits={0}
            />
            <span className="text-zinc-400 dark:text-zinc-500 ml-1.5">{row.asset}</span>
          </span>
        )
      ) : (
        // "PENDING" read as "balance loading" but it actually means
        // "asset is not deployed on this chain". Use an em-dash + tiny
        // helper label so the row doesn't fight for attention with the
        // chain total above. Confirmed by the user: rows that show
        // PENDING never contribute to the total, so the labelling
        // mismatch was the only thing making the total look "wrong".
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
          title={`${row.asset} is not deployed on ${cfg.label}`}
        >
          — Not on {cfg.label.split(" ")[0]}
        </span>
      )}
    </li>
  );
};

export const StablecoinBalances: React.FC = () => {
  const t = useI18n();
  const { address, isConnected } = useAccount();
  const [activeChainId, setActiveChainId] = useState<number>(
    SPOKE_CHAINS[0].chainId,
  );
  const [open, setOpen] = useState(false);

  const activeChain =
    SPOKE_CHAINS.find((c) => c.chainId === activeChainId) ?? SPOKE_CHAINS[0];

  // Single fetch pass covers every chain × every stable. The popover
  // renders only the active chain's rows; the trigger pill sums every
  // chain's USD-equivalent total (which folds non-USD stables in via
  // StableToken.usdPrice, so the pill reflects "how much can I actually
  // settle into USDC right now" instead of "USDC face value only").
  const allChainsRows = useAllChainsStableBalances(address);
  const totalUsdEquivalent = React.useMemo(
    () =>
      Object.values(allChainsRows)
        .flat()
        .reduce((s, r) => s + r.usdValue, 0),
    [allChainsRows],
  );
  // Animated value pulled into a small render helper so the trigger pill,
  // phantom (slot reservation), and panel header all show identical
  // typography + animation. NumberFlow handles the digit transitions.
  const triggerValue = isConnected ? (
    <AnimatedNumber
      value={totalUsdEquivalent}
      maximumFractionDigits={2}
      minimumFractionDigits={2}
    />
  ) : (
    <>—</>
  );

  const chainRows = allChainsRows[activeChain.chainId] ?? [];
  const sortedRows = React.useMemo(() => {
    const tier = (r: ChainBalanceRow): number => {
      if (r.deployed && r.balance > 0) return 0;
      if (r.deployed) return 1;
      return 2; // pending
    };
    return [...chainRows].sort((a, b) => {
      const t = tier(a) - tier(b);
      if (t !== 0) return t;
      // within tier, biggest USD value first; ties break by symbol for stability.
      const v = b.usdValue - a.usdValue;
      if (v !== 0) return v;
      return a.asset.localeCompare(b.asset);
    });
  }, [chainRows]);
  const chainUsdTotal = React.useMemo(
    () => sortedRows.reduce((sum, r) => sum + r.usdValue, 0),
    [sortedRows],
  );

  // Dynamic-Island morph: pill, ad-pill, and panel all share
  // `layoutId="acct-fx-island"`, so framer-motion smoothly animates the
  // box geometry across the three states. The pill stays in the header
  // (its anchor); the panel is portaled to document.body because the
  // parent `.island` has `overflow: hidden` and would clip the morph.
  const [hover, setHover] = useState(false);
  const expanded = hover && !open;

  // APY advertisement loop. Every ~45s while the wallet is closed and
  // the user has idle balance, the pill morphs into a promotional
  // variant showing the opportunity cost of NOT lending — "Earn 4.42%
  // on $13M idle". Mirrors desk-v1's wallet ad pattern. Pulls live
  // markets (cached by the loan tab too — no extra network cost).
  const { markets: liveMarkets } = useTelaranaMarkets();
  const bestSupplyApy = React.useMemo(() => {
    let best = 0;
    for (const m of liveMarkets ?? []) {
      if (!m.state || !m.isLive) continue;
      const supplyAssets = BigInt(m.state.totalSupplyAssets);
      const borrowAssets = BigInt(m.state.totalBorrowAssets);
      const util =
        supplyAssets > 0n
          ? Number((borrowAssets * 10_000n) / supplyAssets) / 10_000
          : 0;
      // IrmMock: supply ≈ util² (Morpho fee=0). Convert fraction → %.
      const supply = util * util * 100;
      if (supply > best) best = supply;
    }
    return best > 0 ? best : null;
  }, [liveMarkets]);

  const adEligible =
    !open && isConnected && totalUsdEquivalent > 100 && bestSupplyApy != null;
  const [adMode, setAdMode] = useState(false);
  useEffect(() => {
    if (!adEligible) {
      setAdMode(false);
      return;
    }
    // First ad fires 12s after eligibility kicks in (lets the page settle),
    // then every 45s. Each impression lasts 5s.
    let hideTimer: number | undefined;
    const showAd = () => {
      setAdMode(true);
      hideTimer = window.setTimeout(() => setAdMode(false), 5000);
    };
    const first = window.setTimeout(showAd, 12_000);
    const interval = window.setInterval(showAd, 45_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      if (hideTimer) window.clearTimeout(hideTimer);
      setAdMode(false);
    };
  }, [adEligible]);

  const opportunityYearly = bestSupplyApy
    ? (totalUsdEquivalent * bestSupplyApy) / 100
    : 0;

  const anchorRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  // createPortal needs document — only flip mounted after hydration so
  // we never call it during SSR.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const el = anchorRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setCoords({ top: r.top, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Esc closes; runs only while open so the listener cost is zero idle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Emil-style: damped spring, no overshoot, soft landing. Slightly slower
  // than the default so the morph reads as deliberate, not flicked open.
  const SPRING = { type: "spring", stiffness: 260, damping: 36, mass: 0.7 } as const;

  return (
    <>
      <div ref={anchorRef} className="acct-island-anchor">
        {/* Phantom: same content as the pill but invisible. Reserves the
            slot in the header so the layout doesn't shift when the real
            pill morphs into the portaled panel. */}
        <span className="acct-mini acct-mini--phantom" aria-hidden="true">
          <span className="acct-l">Stablecoin FX Wallet</span>
          <span className="mono acct-v">{triggerValue}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>

        <AnimatePresence initial={false} mode="popLayout">
          {!open && !adMode && (
            <motion.button
              key="pill"
              type="button"
              layoutId="acct-fx-island"
              className="acct-mini acct-island-pill"
              aria-label="Open Stablecoin FX Wallet"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onFocus={() => setHover(true)}
              onBlur={() => setHover(false)}
              transition={SPRING}
              style={{ borderRadius: 12 }}
            >
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.span
                    key="label"
                    initial={{ opacity: 0, width: 0, marginRight: 0 }}
                    animate={{ opacity: 1, width: "auto", marginRight: 8 }}
                    exit={{ opacity: 0, width: 0, marginRight: 0 }}
                    transition={{ duration: 0.18 }}
                    className="acct-l"
                    style={{ overflow: "hidden", whiteSpace: "nowrap" }}
                  >
                    Stablecoin FX Wallet
                  </motion.span>
                )}
              </AnimatePresence>
              <span className="mono acct-v">{triggerValue}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className="ml-0.5 opacity-70"
              >
                <path
                  d="M2 4 L5 7 L8 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>
          )}
          {!open && adMode && bestSupplyApy != null && (
            <motion.button
              key="ad"
              type="button"
              layoutId="acct-fx-island"
              className="acct-mini acct-island-pill acct-island-ad"
              aria-label={`Earn ${bestSupplyApy.toFixed(2)}% APY by lending — click to view wallet`}
              onClick={() => setOpen(true)}
              transition={SPRING}
              style={{ borderRadius: 12 }}
            >
              <span className="acct-island-ad-bg" aria-hidden="true" />
              <motion.span
                className="acct-island-ad-inner"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 2 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="acct-island-ad-icon"
                >
                  <path
                    d="M6 1.5L8 5.5H4L6 1.5Z M3 6.5h6v4H3z"
                    fill="currentColor"
                  />
                </svg>
                <span className="acct-island-ad-label">Earn</span>
                <span className="mono acct-island-ad-apy">
                  <AnimatedNumber
                    value={bestSupplyApy}
                    currency="%"
                    maximumFractionDigits={2}
                    minimumFractionDigits={2}
                  />
                </span>
                <span className="acct-island-ad-sep" aria-hidden="true">·</span>
                <span className="acct-island-ad-sub">
                  +
                  <AnimatedNumber
                    value={opportunityYearly}
                    maximumFractionDigits={0}
                  />
                  /yr
                </span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                  className="acct-island-ad-arrow"
                >
                  <path
                    d="M2 5 L8 5 M5 2 L8 5 L5 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </motion.span>
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
                  aria-label="Close wallet"
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
                <motion.div
                  key="panel"
                  layoutId="acct-fx-island"
                  className="acct-island-panel"
                  role="dialog"
                  aria-label="Stablecoin FX Wallet"
                  aria-modal="false"
                  transition={SPRING}
                  style={{
                    position: "fixed",
                    top: coords?.top ?? 0,
                    right: coords?.right ?? 16,
                    borderRadius: 18,
                  }}
                >
                  <motion.div
                    className="acct-island-panel-inner"
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{
                      duration: 0.26,
                      delay: 0.10,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <div className="acct-island-head">
                      <div className="acct-island-head-l">
                        <span className="acct-l">Stablecoin FX Wallet</span>
                        <span className="mono acct-v">{triggerValue}</span>
                      </div>
                      <div className="acct-island-head-r">
                        <span
                          className={
                            "acct-island-role " +
                            (activeChain.role === "hub" ? "is-hub" : "is-spoke")
                          }
                        >
                          {activeChain.role}
                        </span>
                        <button
                          type="button"
                          className="acct-island-close"
                          aria-label="Close wallet"
                          onClick={() => setOpen(false)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            aria-hidden="true"
                          >
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
                    </div>

                    <div className="acct-island-network">
                      <ChainSelect
                        value={String(activeChainId)}
                        onChange={(v) => setActiveChainId(Number(v))}
                        chains={SPOKE_CHAINS.map((c) => c.chain)}
                        label={t('Wallet.network')}
                        variant="ghost"
                      />
                    </div>

                    <ul className="acct-island-list">
                      {sortedRows.map((row) => (
                        <TokenBalanceRow
                          key={`${activeChain.chainId}-${row.asset}`}
                          cfg={activeChain}
                          row={row}
                        />
                      ))}
                    </ul>

                    {isConnected ? (
                      <div className="acct-island-foot">
                        <span className="acct-island-foot-l">{t('Wallet.totalOnThisChain')}</span>
                        <span
                          className="mono acct-island-foot-v"
                          title="Approximate sum of all token balances on this chain, converted to USDC face value via reference FX rates. Not a tradeable quote."
                        >
                          <span style={{ marginRight: 4 }}>≈</span>
                          <AnimatedNumber
                            value={chainUsdTotal}
                            maximumFractionDigits={2}
                            minimumFractionDigits={2}
                          />
                          <span style={{ marginLeft: 4 }}>USDC</span>
                        </span>
                      </div>
                    ) : (
                      <div className="acct-island-empty">
                        {t('Wallet.connectForBalances')}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              </React.Fragment>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};

export default StablecoinBalances;
