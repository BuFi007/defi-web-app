"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import {
  fetchMarkets,
  type TelaranaMarketSerialized,
} from "@/lib/telarana/client";

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
  perpsTvl: number;
  vaultTvl: number;
  poolsTvl: number;
}

const EMPTY: TvlData = {
  totalTvl: 0,
  breakdown: [],
  morphoTvl: 0,
  perpsTvl: 0,
  vaultTvl: 0,
  poolsTvl: 0,
};

function buildTvl(markets: TelaranaMarketSerialized[]): TvlData {
  const byChain = new Map<number, Map<string, number>>();

  for (const m of markets) {
    const supply = parseSupply(m);
    if (supply <= 0) continue;

    const sym = symbolOf(m.loanToken);
    if (!byChain.has(m.hubChainId)) byChain.set(m.hubChainId, new Map());
    const chainMap = byChain.get(m.hubChainId)!;
    chainMap.set(sym, (chainMap.get(sym) ?? 0) + supply);
  }

  let totalTvl = 0;
  const breakdown: TvlChainBreakdown[] = [];

  for (const [chainId, assetMap] of byChain) {
    const assets: TvlAsset[] = [];
    for (const [symbol, amount] of assetMap) {
      assets.push({ symbol, amount, usdValue: amount });
      totalTvl += amount;
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
    totalTvl,
    breakdown,
    morphoTvl: totalTvl,
    perpsTvl: 0,
    vaultTvl: 0,
    poolsTvl: 0,
  };
}

export function useTvl(): TvlData {
  const [markets, setMarkets] = useState<TelaranaMarketSerialized[]>([]);

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
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return useMemo(() => (markets.length ? buildTvl(markets) : EMPTY), [markets]);
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
