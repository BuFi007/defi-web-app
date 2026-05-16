/**
 * @bufi/fx-telarana — domain layer for the FX lending/borrowing backend.
 *
 * Owned by worktree feature/fx-telarana-lending-backend.
 *
 * FX Telaraña is a decentralized stablecoin-FX lending protocol —
 * USDC/EURC, USDC/MXNB, USDC/BRL, USDC/JPYC, USDC/QCAD. Eventually
 * integrates Morpho-style vaults, Uniswap v4 hooks, Circle CCTP /
 * Gateway, and oracle-backed risk. The backend's job is to expose
 * indexed positions, price quotes, and intent digests — never to be
 * the source of truth for money.
 */

import type { FxLoanPosition, LoanStatus, MarketRegistryEntry } from "@bufi/shared-types";

import type {
  BorrowIntentRequest,
  BorrowIntentResponse,
  BorrowQuoteRequest,
  BorrowQuoteResponse,
} from "./schemas";

export * from "./schemas";

export interface FxTelaranaService {
  /** List FX lending markets for a given chain. */
  listMarkets(chainId: number): Promise<MarketRegistryEntry[]>;
  /** Get one market's current state (rates, oracle freshness, etc). */
  getMarket(chainId: number, marketId: string): Promise<MarketRegistryEntry | null>;
  /** Build a borrow quote — projected APY, LTV, health factor. */
  borrowQuote(req: BorrowQuoteRequest): Promise<BorrowQuoteResponse>;
  /** Build the borrow intent digest the borrower signs. */
  createBorrowIntent(req: BorrowIntentRequest): Promise<BorrowIntentResponse>;
  /** List a borrower's positions across all markets. */
  positionsFor(borrower: string): Promise<FxLoanPosition[]>;
  /** Liquidation scanner — open positions with HF < 1.0. */
  liquidationCandidates(chainId: number): Promise<FxLoanPosition[]>;
}

export type { FxLoanPosition, LoanStatus, MarketRegistryEntry };
