/**
 * @bufi/perps — domain layer for the perpetuals backend.
 *
 * Owned by worktree feature/perps-backend-final. The worktree fills in
 * each `TODO` below, exposes implementations via `createPerpsService`,
 * and wires the service into apps/api/src/routes/perps.ts.
 *
 * Truth boundaries:
 *   - Quotes:    indexer + oracle reads (no client-supplied price ever trusted)
 *   - Intents:   EIP-712 typed-data digest built server-side, signed by trader
 *   - Positions: Ponder-indexed events, reconciled against contract reads
 *   - Funding:   periodic snapshot job (TODO worktree)
 *   - Liquidations: scanner that re-checks healthFactor on each new block
 */

import type {
  FxQuoteSymbol,
  MarketRegistryEntry,
  PerpIntent,
  PerpQuote,
} from "@bufi/shared-types";

import type {
  PerpsIntentRequest,
  PerpsIntentResponse,
  PerpsQuoteRequest,
  PerpsQuoteResponse,
} from "./schemas";

export * from "./schemas";

export interface PerpsService {
  /** Hydrate the per-chain market registry. */
  listMarkets(chainId: number): Promise<MarketRegistryEntry[]>;
  /** Read a market's latest indexed state. */
  getMarket(chainId: number, marketId: string): Promise<MarketRegistryEntry | null>;
  /**
   * Build a free indicative quote. Uses indexed price + oracle freshness;
   * does NOT do premium simulation (paid `/perps/quote/premium` for that).
   */
  quote(req: PerpsQuoteRequest): Promise<PerpsQuoteResponse>;
  /** Build the EIP-712 intent digest for the trader to sign. */
  createIntent(req: PerpsIntentRequest): Promise<PerpsIntentResponse>;
  /** List a trader's open positions. */
  listPositions(trader: string): Promise<PerpQuote[]>;
  /** Funding rate history snapshot. */
  funding(chainId: number, marketId: string): Promise<Array<{ at: number; bps: number }>>;
  /** Health-factor scanner — positions with HF < 1.0. */
  liquidationCandidates(chainId: number): Promise<PerpIntent[]>;
}

// Public placeholder so the type can be exported even before the impl lands.
export type { FxQuoteSymbol };
