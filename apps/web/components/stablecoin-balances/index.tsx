"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
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
import { useUnifiedUsdcBalance } from "@/lib/circle-gateway/use-unified-usdc-balance";
import { Skeleton } from "@/components/ui/skeleton";

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
//
// Wk1d1: replaced an N×M (~40) nested `useBalance` fan-out with one
// `useReadContracts` per chain — wagmi v2 routes batched balanceOf calls
// through multicall3 (canonical address is wired into each chain's viem
// definition: Avalanche Fuji, Arc Testnet, Sepolia, Arbitrum Sepolia all
// have it at 0xcA11bde…CA11). End-state: ~40 eth_calls → 4 multicalls,
// one per chain. Hook count is now N_chains (constant 4) instead of
// N_chains × M_tokens.
const useAllChainsStableBalances = (
  walletAddress: Address | undefined,
): Record<number, ChainBalanceRow[]> => {
  // One `useReadContracts` per chain in fixed `SPOKE_CHAINS` order. The
  // hook count is the SPOKE_CHAINS length — stable across renders even
  // though we're calling a hook inside `.map()`, identical to the prior
  // pattern's justification.
  //
  // We only include DEPLOYED tokens in the batched `contracts[]`; an
  // undeployed slot would either error (no address) or read the wrong
  // contract. The full STABLE_TOKEN_LIST grid still drives the output
  // shape — undeployed entries are emitted as `deployed: false` rows
  // without consuming a multicall slot.
  const chainBatches = SPOKE_CHAINS.map((cfg) => {
    type SlotMeta = {
      asset: StableTokenType;
      address: Address;
      decimals: number;
      usdPrice: number;
    };
    const deployedSlots: SlotMeta[] = [];
    for (const t of STABLE_TOKEN_LIST) {
      const deployment = cfg.tokens.find((d) => d.asset === t.asset);
      if (!deployment?.address) continue;
      deployedSlots.push({
        asset: t.asset,
        address: deployment.address as Address,
        decimals: deployment.decimals ?? 6,
        usdPrice: t.usdPrice ?? 0,
      });
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const query = useReadContracts({
      // wagmi v2 picks up the canonical multicall3 from viem's chain
      // definition (see comment above) and batches every read here into
      // a single `aggregate3` call.
      contracts: deployedSlots.map((s) => ({
        address: s.address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [walletAddress ?? "0x0000000000000000000000000000000000000000"] as readonly [Address],
        chainId: cfg.chainId as NonNullable<WagmiChainId>,
      })),
      allowFailure: true,
      query: {
        enabled: Boolean(cfg.isWagmiSupported && walletAddress),
      },
    });

    return { cfg, deployedSlots, query };
  });

  const result: Record<number, ChainBalanceRow[]> = {};
  for (const { cfg, deployedSlots, query } of chainBatches) {
    // Build the FULL grid (STABLE_TOKEN_LIST × this chain). Deployed
    // entries pull their balance from the multicall result by index;
    // undeployed entries emit the same shape with `deployed: false`.
    const slotByAsset = new Map(
      deployedSlots.map((s, idx) => [s.asset, { slot: s, idx }] as const),
    );
    result[cfg.chainId] = STABLE_TOKEN_LIST.map((t): ChainBalanceRow => {
      const hit = slotByAsset.get(t.asset);
      if (!hit) {
        return {
          asset: t.asset,
          address: null,
          decimals: 6,
          formatted: "0",
          balance: 0,
          usdValue: 0,
          deployed: false,
          isLoading: false,
        };
      }
      const { slot, idx } = hit;
      const entry = query.data?.[idx];
      const raw =
        entry && entry.status === "success" ? (entry.result as bigint) : null;
      const formatted = raw !== null ? formatUnits(raw, slot.decimals) : "0";
      const balance = raw !== null ? Number(formatted) : 0;
      const usdValue =
        Number.isFinite(balance) ? balance * slot.usdPrice : 0;
      return {
        asset: slot.asset,
        address: slot.address,
        decimals: slot.decimals,
        formatted,
        balance,
        usdValue,
        deployed: true,
        isLoading: query.isLoading,
      };
    });
  }
  return result;
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
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Pending
        </span>
      )}
    </li>
  );
};

export const StablecoinBalances: React.FC = () => {
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

  // Circle Gateway unified USDC balance. Hook returns a `disabled: true`
  // state when no proxy URL is configured (no toast, no error) so the
  // popover collapses the section cleanly in unconfigured envs. The
  // `perHub` map is chainId → decimal-string and only contains chains
  // that Gateway tracks for this address — we filter SPOKE_CHAINS by it
  // when rendering the breakdown.
  const gateway = useUnifiedUsdcBalance({ walletAddress: address });
  const gatewayTotalUsdc = React.useMemo(
    () => Number(gateway.value.total),
    [gateway.value.total],
  );
  const gatewayBreakdownRows = React.useMemo(() => {
    if (gateway.value.disabled) return [];
    // Only surface chains we have a popover label for. Gateway-supported
    // chains we don't render (OP Sepolia, Base Sepolia, etc.) still
    // contribute to the unified total — they just don't get a row.
    return SPOKE_CHAINS.map((cfg) => {
      const raw = gateway.value.perHub[String(cfg.chainId)];
      const value = raw ? Number(raw) : 0;
      return { cfg, value, deployed: raw !== undefined };
    })
      .filter((r) => r.deployed)
      .sort((a, b) => b.value - a.value);
  }, [gateway.value.disabled, gateway.value.perHub]);
  const [gatewayExpanded, setGatewayExpanded] = useState(false);

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
                        label="Network"
                        variant="ghost"
                      />
                    </div>

                    {/* Circle Gateway unified USDC balance. Hidden when the
                        proxy isn't configured (env-var absent) so unconfigured
                        envs see the same popover as before. Tap the row to
                        expand the per-hub breakdown — Gateway tracks USDC
                        across every CCTP-Gateway domain, but we only render
                        labels for the ones the popover knows about (Arc,
                        Fuji, etc.); other domains still roll into `total`. */}
                    {!gateway.value.disabled && isConnected && (
                      <div className="gateway-island-section">
                        <button
                          type="button"
                          className="gateway-island-row"
                          aria-expanded={gatewayExpanded}
                          aria-controls="gateway-island-breakdown"
                          onClick={() => setGatewayExpanded((v) => !v)}
                          disabled={gateway.value.isLoading || gatewayBreakdownRows.length === 0}
                        >
                          <span className="gateway-island-row-l">
                            <span className="gateway-island-badge" aria-hidden="true">
                              Gateway
                            </span>
                            <span className="acct-l">USDC across all hubs</span>
                          </span>
                          <span className="gateway-island-row-r">
                            {gateway.value.isLoading ? (
                              <Skeleton className="h-[15px] w-[68px] rounded" />
                            ) : gateway.value.error ? (
                              <span className="gateway-island-err" title={gateway.value.error.message}>
                                unavailable
                              </span>
                            ) : (
                              <>
                                <span className="mono gateway-island-v">
                                  <AnimatedNumber
                                    value={gatewayTotalUsdc}
                                    maximumFractionDigits={2}
                                    minimumFractionDigits={2}
                                  />
                                </span>
                                <span className="gateway-island-unit">USDC</span>
                                {gatewayBreakdownRows.length > 0 && (
                                  <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 10 10"
                                    aria-hidden="true"
                                    className="gateway-island-chev"
                                    style={{
                                      transform: gatewayExpanded
                                        ? "rotate(180deg)"
                                        : "rotate(0deg)",
                                      transition: "transform 0.18s ease",
                                    }}
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
                                )}
                              </>
                            )}
                          </span>
                        </button>
                        <AnimatePresence initial={false}>
                          {gatewayExpanded && gatewayBreakdownRows.length > 0 && (
                            <motion.ul
                              id="gateway-island-breakdown"
                              className="gateway-island-breakdown"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            >
                              {gatewayBreakdownRows.map((r) => (
                                <li key={`gw-${r.cfg.chainId}`} className="gateway-island-breakdown-row">
                                  <span className="gateway-island-breakdown-l">{r.cfg.label}</span>
                                  <span className="mono gateway-island-breakdown-v tabular-nums">
                                    <AnimatedNumber
                                      value={r.value}
                                      maximumFractionDigits={2}
                                      minimumFractionDigits={2}
                                    />
                                    <span className="text-zinc-400 dark:text-zinc-500 ml-1">USDC</span>
                                  </span>
                                </li>
                              ))}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

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
                        <span className="acct-island-foot-l">Total on this chain</span>
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
                        Connect a wallet to see live balances.
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
