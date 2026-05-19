"use client";

import React, { useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits, type Address } from "viem";
import type { WagmiChainId } from "@/utils/chain";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChainSelect } from "@/components/chain-select";
import { BalanceDisplay } from "@/components/balance-display";
import { TokenChip } from "@/components/token-chip";
import { fmtUSD } from "@/components/trade-island/data";
import {
  STABLE_TOKEN_LIST,
  type StableTokenType,
} from "@bufi/location/stable-tokens";
import type { Token } from "@/lib/types";

import { SPOKE_CHAINS, type SpokeChain } from "./deployments";

const TOKEN_META = Object.fromEntries(
  STABLE_TOKEN_LIST.map((t) => [t.asset, t] as const),
) as Record<StableTokenType, (typeof STABLE_TOKEN_LIST)[number]>;

const iconSrc = (icon: (typeof STABLE_TOKEN_LIST)[number]["icon"]): string =>
  typeof icon === "string" ? icon : icon.src;

// Rough USD price table for ordering + the USDC-equivalent preview line.
// These are NOT used for trading anywhere — only to rank rows by face
// value and to surface a single approximate "≈ $X USDC total" so the
// user can glance and see what they're holding without doing the math.
// Replace with a Pyth-backed lookup when the FX price service lands.
const TOKEN_USD_PRICE: Record<StableTokenType, number> = {
  USDC: 1.0,
  EURC: 1.084,
  AUDF: 0.6648,
  BRLA: 0.1724, // BRL/USD ≈ 5.8
  JPYC: 0.00648, // JPY/USD ≈ 154
  KRW1: 0.000726, // KRW/USD ≈ 1378
  MXNB: 0.0585, // MXN/USD ≈ 17.1
  PHPC: 0.01754, // PHP/USD ≈ 57
  QCAD: 0.7299, // CAD/USD ≈ 1.37
  ZARU: 0.0526, // ZAR/USD ≈ 19
};

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
  /** Face-value in USD via TOKEN_USD_PRICE. 0 when no deployment. */
  usdValue: number;
  deployed: boolean;
  isLoading: boolean;
}

// Read every stablecoin balance on the active chain in fixed order so the
// hook count stays stable across renders. Returns one row per
// STABLE_TOKEN_LIST entry; the caller sorts + renders. Lifting the
// fetches up here lets the popover order rows by USD value AND sum a
// USDC-equivalent total without each row knowing about its siblings.
const useChainStableBalances = (
  cfg: SpokeChain,
  walletAddress: Address | undefined,
): ChainBalanceRow[] => {
  return STABLE_TOKEN_LIST.map((t): ChainBalanceRow => {
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
    const price = TOKEN_USD_PRICE[t.asset] ?? 0;
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
        <BalanceDisplay
          balance={row.formatted}
          isLoading={row.isLoading}
          symbol={row.asset}
        />
      ) : (
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Pending
        </span>
      )}
    </li>
  );
};

// USDC face-value sum across every wagmi-supported chain. Each call is
// fixed-order so hook count is stable; chains without a USDC deployment
// just no-op via `enabled: false`.
const useUsdcAcrossChains = (walletAddress: Address | undefined): number => {
  const chains = SPOKE_CHAINS;
  const balances = chains.map((cfg) => {
    const deployment = cfg.tokens.find((t) => t.asset === "USDC");
    const decimals = deployment?.decimals ?? 6;
    const enabled = Boolean(
      cfg.isWagmiSupported && deployment?.address && walletAddress,
    );
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const bal = useBalance({
      address: walletAddress,
      token: deployment?.address as Address | undefined,
      chainId: cfg.chainId as NonNullable<WagmiChainId>,
      query: { enabled },
    });
    return bal.data ? Number(formatUnits(bal.data.value, decimals)) : 0;
  });
  return balances.reduce((s, n) => s + n, 0);
};

export const StablecoinBalances: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [activeChainId, setActiveChainId] = useState<number>(
    SPOKE_CHAINS[0].chainId,
  );

  const activeChain =
    SPOKE_CHAINS.find((c) => c.chainId === activeChainId) ?? SPOKE_CHAINS[0];

  // Trigger total: USDC face-value sum across all configured chains. EURC
  // and other non-USD stables are intentionally not folded in until a
  // Pyth-backed FX rate lands — face-value of EURC ≠ USD without one.
  const totalUsdc = useUsdcAcrossChains(address);
  const triggerLabel = isConnected ? fmtUSD(totalUsdc) : "—";

  // Per-active-chain balances. Sorted: available (deployed + balance > 0)
  // first, ranked by USD value descending; then deployed-but-zero rows;
  // then pending rows (no deployment on this chain). Sums to a single
  // USDC-equivalent preview shown beneath the list.
  const chainRows = useChainStableBalances(activeChain, address);
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="acct-mini"
          title="Stablecoin balances"
          aria-label="Open stablecoin balances"
        >
          <span className="acct-l">Wallet</span>
          <span className="mono acct-v">{triggerLabel}</span>
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
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] p-0 bg-white dark:bg-zinc-900 border-2 border-purpleDanis/40 dark:border-violetDanis/40 rounded-2xl shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            Stablecoin balances
          </div>
          <div
            className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              activeChain.role === "hub"
                ? "bg-purpleDanis/15 text-purpleDanis"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {activeChain.role}
          </div>
        </div>

        <div className="px-3 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <ChainSelect
            value={String(activeChainId)}
            onChange={(v) => setActiveChainId(Number(v))}
            chains={SPOKE_CHAINS.map((c) => c.chain)}
            label="Network"
            variant="ghost"
          />
        </div>

        <ul className="p-2 max-h-80 overflow-y-auto">
          {sortedRows.map((row) => (
            <TokenBalanceRow
              key={`${activeChain.chainId}-${row.asset}`}
              cfg={activeChain}
              row={row}
            />
          ))}
        </ul>

        {isConnected && (
          <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Total on this chain
            </span>
            <span
              className="mono text-[12px] font-bold text-purpleDanis dark:text-violetDanis tabular-nums"
              title="Approximate sum of all token balances on this chain, converted to USDC face value via reference FX rates. Not a tradeable quote."
            >
              ≈ {fmtUSD(chainUsdTotal)} USDC
            </span>
          </div>
        )}

        {!isConnected && (
          <div className="px-4 py-3 text-center text-xs text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">
            Connect a wallet to see live balances.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default StablecoinBalances;
