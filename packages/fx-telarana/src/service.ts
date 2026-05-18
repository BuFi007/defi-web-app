/**
 * Legacy service surface kept for backwards compatibility with the previous
 * stub layout. New code should call the SDK directly (listMarkets,
 * quoteBorrow, buildBorrowIntent, ...). The API routes now use the SDK.
 */
import type { Hex } from "viem";

import { CONTRACTS, SPOT_FX_ROUTES } from "@bufi/contracts";
import {
  TELARANA_DEPLOYMENTS,
  type TelaranaHubChainId,
} from "@bufi/contracts/telarana";
import type { FxLoanPosition, MarketRegistryEntry } from "@bufi/shared-types";

import { listAccountPositions } from "./positions";
import {
  borrowIntentRequest,
  borrowQuoteRequest,
  type BorrowIntentRequest,
  type BorrowIntentResponse,
  type BorrowQuoteRequest,
  type BorrowQuoteResponse,
} from "./schemas";

export interface BorrowQuoteReader {
  previewBorrow(req: BorrowQuoteRequest): Promise<BorrowQuoteResponse>;
}

export interface FxTelaranaService {
  listMarkets(chainId: number): Promise<MarketRegistryEntry[]>;
  getMarket(chainId: number, marketId: string): Promise<MarketRegistryEntry | null>;
  borrowQuote(req: BorrowQuoteRequest): Promise<BorrowQuoteResponse>;
  createBorrowIntent(req: BorrowIntentRequest): Promise<BorrowIntentResponse>;
  positionsFor(borrower: string): Promise<FxLoanPosition[]>;
  liquidationCandidates(chainId: number): Promise<FxLoanPosition[]>;
}

export function createFxTelaranaService(
  opts: { quoteReader?: BorrowQuoteReader } = {},
): FxTelaranaService {
  const markets = liveTelaranaMarkets();
  return {
    async listMarkets(chainId) {
      return markets.filter((m) => m.chainId === chainId);
    },
    async getMarket(chainId, marketId) {
      return markets.find((m) => m.chainId === chainId && m.marketId === marketId) ?? null;
    },
    async borrowQuote(req) {
      const parsed = borrowQuoteRequest.parse(req);
      if (!opts.quoteReader) {
        throw new Error(
          "borrow quote reader is not configured; use on-chain previewBorrow before returning a quote",
        );
      }
      return opts.quoteReader.previewBorrow(parsed);
    },
    async createBorrowIntent(req) {
      borrowIntentRequest.parse(req);
      throw new Error("legacy createBorrowIntent path is deprecated; use the SDK buildBorrowIntent");
    },
    async positionsFor(borrower) {
      const positions = await listAccountPositions({ account: borrower as `0x${string}` });
      return positions.map((p): FxLoanPosition => ({
        positionId: p.id,
        borrower: p.account,
        marketId: p.marketId,
        collateralAsset: "0x0000000000000000000000000000000000000000",
        collateralAmount: p.collateral.toString(),
        borrowAsset: "0x0000000000000000000000000000000000000000",
        borrowAmount: p.borrowAssets.toString(),
        healthFactorBps: p.healthFactorE18
          ? Number(p.healthFactorE18 / 100_000_000_000_000n)
          : 10_000,
        status: p.liquidatable ? "liquidated" : "open",
      }));
    },
    async liquidationCandidates() {
      return [];
    },
  };
}

/**
 * Surface declared markets from the on-chain manifests as MarketRegistryEntry
 * rows. Preserves the legacy SPOT_FX_ROUTES rows so the agent flow still has
 * symbol-keyed entries (USDC/EURC etc) while the real market id lookups go
 * through the SDK.
 */
export function liveTelaranaMarkets(): MarketRegistryEntry[] {
  const arc = CONTRACTS[5042002];
  const legacy = Object.entries(SPOT_FX_ROUTES).map(([symbol, route]): MarketRegistryEntry => ({
    marketId: route.routeId,
    symbol: `USDC/${symbol}`,
    baseAsset: arc.tokens.usdc!,
    quoteAsset: route.tokenOut,
    source: "pyth",
    chainId: 5042002,
    enabled: true,
  }));

  const telaranaRows = (Object.entries(TELARANA_DEPLOYMENTS) as Array<
    [string, (typeof TELARANA_DEPLOYMENTS)[TelaranaHubChainId]]
  >).flatMap(([chainIdStr, deployment]) =>
    deployment.markets.map((m): MarketRegistryEntry => ({
      marketId: m.id as Hex,
      symbol: `${m.loanSymbol}/${m.collateralSymbol}`,
      baseAsset: m.loanToken,
      quoteAsset: m.collateralToken,
      source: "internal",
      chainId: Number(chainIdStr) as TelaranaHubChainId,
      enabled: true,
    })),
  );

  return [...telaranaRows, ...legacy];
}
