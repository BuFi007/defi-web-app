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

export * from "./schemas";
export * from "./service";
export type { FxLoanPosition, LoanStatus, MarketRegistryEntry } from "@bufi/shared-types";
