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

// One row = one useBalance call. Keyed by (chainId, asset) at the call
// site so the hook count stays stable when the user toggles chains.
const TokenBalanceRow: React.FC<{
  cfg: SpokeChain;
  asset: StableTokenType;
  walletAddress: Address | undefined;
}> = ({ cfg, asset, walletAddress }) => {
  const deployment = cfg.tokens.find((t) => t.asset === asset);
  const decimals = deployment?.decimals ?? 6;
  const address = deployment?.address ?? null;

  // Only fetch when the chain is wagmi-supported AND a token address
  // exists. Otherwise this is a Pending row and we don't burn an RPC call.
  const canFetch = cfg.isWagmiSupported && Boolean(address && walletAddress);
  const bal = useBalance({
    address: walletAddress,
    token: (address ?? undefined) as Address | undefined,
    chainId: cfg.chainId as NonNullable<WagmiChainId>,
    query: { enabled: canFetch },
  });

  const tokenForChip = toToken(cfg, asset, address, decimals);
  const formatted = bal?.data ? formatUnits(bal.data.value, decimals) : "0";

  return (
    <li className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <TokenChip token={tokenForChip} chain={cfg.chain} />
      {address ? (
        <BalanceDisplay
          balance={formatted}
          isLoading={Boolean(bal?.isLoading)}
          symbol={asset}
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
          />
        </div>

        <ul className="p-2 max-h-80 overflow-y-auto">
          {STABLE_TOKEN_LIST.map((t) => (
            <TokenBalanceRow
              key={`${activeChain.chainId}-${t.asset}`}
              cfg={activeChain}
              asset={t.asset}
              walletAddress={address}
            />
          ))}
        </ul>

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
