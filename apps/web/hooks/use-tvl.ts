"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import {
  fetchMarkets,
  type TelaranaMarketSerialized,
} from "@/lib/telarana/client";
import { mcpFetch } from "@/lib/protocol/client";

const POLL_MS = 30_000;

const CHAIN_NAMES: Record<number, string> = {
  5042002: "Arc Testnet",
  43113: "Avalanche Fuji",
};

const TOKEN_SYMBOLS: Record<string, string> = {};

function cacheSymbol(addr: string, symbol: string) {
  TOKEN_SYMBOLS[addr.toLowerCase()] = symbol;
}

function symbolOf(addr: string): string {
  return TOKEN_SYMBOLS[addr.toLowerCase()] ?? addr.slice(0, 6);
}

function decimalsForSymbol(symbol: string): number {
  return symbol.toUpperCase() === "JPYC" ? 18 : 6;
}

function parseSupply(market: TelaranaMarketSerialized): number {
  if (!market.state?.totalSupplyAssets) return 0;
  const pair = guessSymbols(market);
  const symbol = pair?.loan ?? symbolOf(market.loanToken);
  return Number(formatUnits(BigInt(market.state.totalSupplyAssets), decimalsForSymbol(symbol)));
}

export interface TvlAsset {
  symbol: string;
  amount: number;
  usdValue: number;
}

export interface TvlChainBreakdown {
  chainId: number;
  chainName: string;
  assets: TvlAsset[];
}

export interface TvlData {
  totalTvl: number;
  breakdown: TvlChainBreakdown[];
  morphoTvl: number;
  vaultTvl: number;
  gatewayTvl: number;
}

const EMPTY: TvlData = {
  totalTvl: 0,
  breakdown: [],
  morphoTvl: 0,
  vaultTvl: 0,
  gatewayTvl: 0,
};

const ARC_CHAIN_ID = 5042002;

// morphoTvl = lending supply (bufx API). vaultTvl/gatewayTvl come from the MCP
// protocol reads (SharedFxVault depths + FxGatewayHook) so the numbers are exact
// per the contracts. The vault junior buffer (USD) also shows in the breakdown.
function buildTvl(markets: TelaranaMarketSerialized[], vaultTvl: number, gatewayTvl: number): TvlData {
  const byChain = new Map<number, Map<string, number>>();
  let morphoTvl = 0;

  for (const m of markets) {
    const supply = parseSupply(m);
    if (supply <= 0) continue;
    morphoTvl += supply;
    const sym = symbolOf(m.loanToken);
    if (!byChain.has(m.hubChainId)) byChain.set(m.hubChainId, new Map());
    const chainMap = byChain.get(m.hubChainId)!;
    chainMap.set(sym, (chainMap.get(sym) ?? 0) + supply);
  }

  // Vault junior buffer (USD-denominated) is protocol-owned liquidity on Arc.
  if (vaultTvl > 0) {
    if (!byChain.has(ARC_CHAIN_ID)) byChain.set(ARC_CHAIN_ID, new Map());
    const arc = byChain.get(ARC_CHAIN_ID)!;
    arc.set("Vault", (arc.get("Vault") ?? 0) + vaultTvl);
  }

  const breakdown: TvlChainBreakdown[] = [];
  for (const [chainId, assetMap] of byChain) {
    const assets: TvlAsset[] = [];
    for (const [symbol, amount] of assetMap) {
      assets.push({ symbol, amount, usdValue: amount });
    }
    assets.sort((a, b) => b.usdValue - a.usdValue);
    breakdown.push({
      chainId,
      chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
      assets,
    });
  }

  breakdown.sort((a, b) => {
    const aTotal = a.assets.reduce((s, x) => s + x.usdValue, 0);
    const bTotal = b.assets.reduce((s, x) => s + x.usdValue, 0);
    return bTotal - aTotal;
  });

  return {
    totalTvl: morphoTvl + vaultTvl + gatewayTvl,
    breakdown,
    morphoTvl,
    vaultTvl,
    gatewayTvl,
  };
}

export function useTvl(): TvlData {
  const [markets, setMarkets] = useState<TelaranaMarketSerialized[]>([]);
  const [vaultTvl, setVaultTvl] = useState(0);
  const [gatewayTvl, setGatewayTvl] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      for (const m of data.markets) {
        const pair = guessSymbols(m);
        if (pair) {
          cacheSymbol(m.loanToken, pair.loan);
          cacheSymbol(m.collateralToken, pair.collateral);
        }
      }
      setMarkets(data.markets);
    } catch {
      // keep stale data
    }
    // Protocol-owned liquidity from the MCP (exact per contracts): vault junior
    // buffer (USD) + cross-hub gateway balance. Each guarded independently.
    try {
      const v = await mcpFetch<{ totalJuniorUsdc?: string; seniorUsdcHot?: string }>("/api/vault/depths");
      setVaultTvl((Number(v?.totalJuniorUsdc) || 0) + (Number(v?.seniorUsdcHot) || 0));
    } catch {
      // keep stale
    }
    try {
      const g = await mcpFetch<{ gatewayBalance?: string }>("/api/gateway/info");
      setGatewayTvl(Number(g?.gatewayBalance) || 0);
    } catch {
      // keep stale
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return useMemo(
    () => (markets.length || vaultTvl || gatewayTvl ? buildTvl(markets, vaultTvl, gatewayTvl) : EMPTY),
    [markets, vaultTvl, gatewayTvl],
  );
}

function guessSymbols(
  m: TelaranaMarketSerialized,
): { loan: string; collateral: string } | null {
  const id = m.id.toLowerCase();
  if (id.includes("eurc") || id.length > 4) {
    // Use the hubName + market pattern: M1 = EURC/USDC, M2 = USDC/EURC
    // We derive from known address patterns instead.
  }
  const loan = m.loanToken.toLowerCase();
  const collateral = m.collateralToken.toLowerCase();

  const KNOWN: Record<string, string> = {
    "0x5425890298aed601595a70ab815c96711a31bc65": "USDC",
    "0x3600000000000000000000000000000000000000": "USDC",
    "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
    "0x50c4ba39caa7f56152d0df4914e1f6b907194992": "EURC",
    "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29": "JPYC",
    "0xe7c3d8e0c82f73fd4fabbc73e68b328318c29000": "JPYC",
  };

  const loanSym = KNOWN[loan];
  const collSym = KNOWN[collateral];
  if (loanSym || collSym) {
    return {
      loan: loanSym ?? "???",
      collateral: collSym ?? "???",
    };
  }
  return null;
}
