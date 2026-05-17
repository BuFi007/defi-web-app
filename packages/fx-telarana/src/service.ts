import { CONTRACTS, SPOT_FX_ROUTES } from "@bufi/contracts";
import type { FxLoanPosition, MarketRegistryEntry } from "@bufi/shared-types";

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

export function createFxTelaranaService(opts: { quoteReader?: BorrowQuoteReader } = {}): FxTelaranaService {
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
        throw new Error("borrow quote reader is not configured; use on-chain previewBorrow before returning a quote");
      }
      return opts.quoteReader.previewBorrow(parsed);
    },
    async createBorrowIntent(req) {
      const parsed = borrowIntentRequest.parse(req);
      throw new Error(
        `borrow intent routing is not configured for ${parsed.marketId}; deploy the lending intent contract before accepting signed debt`,
      );
    },
    async positionsFor() {
      return [];
    },
    async liquidationCandidates() {
      return [];
    },
  };
}

export function liveTelaranaMarkets(): MarketRegistryEntry[] {
  const arc = CONTRACTS[5042002];
  return Object.entries(SPOT_FX_ROUTES).map(([symbol, route]) => ({
    marketId: route.routeId,
    symbol: `USDC/${symbol}`,
    baseAsset: arc.tokens.usdc!,
    quoteAsset: route.tokenOut,
    source: "pyth",
    chainId: 5042002,
    enabled: true,
  }));
}
