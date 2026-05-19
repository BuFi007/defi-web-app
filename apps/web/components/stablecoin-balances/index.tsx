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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    return [cfg.chainId, rows] as const;
  });
  return Object.fromEntries(entries);
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
  // TOKEN_USD_PRICE, so the pill reflects "how much can I actually
  // settle into USDC right now" instead of "USDC face value only").
  const allChainsRows = useAllChainsStableBalances(address);
  const totalUsdEquivalent = React.useMemo(
    () =>
      Object.values(allChainsRows)
        .flat()
        .reduce((s, r) => s + r.usdValue, 0),
    [allChainsRows],
  );
  const triggerLabel = isConnected ? fmtUSD(totalUsdEquivalent) : "—";

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Force the hover tooltip closed while the popover is open so the
          chip ("Stablecoin FX Wallet") doesn't float over the panel. */}
      <Tooltip open={open ? false : undefined}>
        <PopoverTrigger asChild>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="acct-mini"
              aria-label="Open Stablecoin FX Wallet"
            >
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
          </TooltipTrigger>
        </PopoverTrigger>
        <TooltipContent sideOffset={8}>Stablecoin FX Wallet</TooltipContent>
      </Tooltip>
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
