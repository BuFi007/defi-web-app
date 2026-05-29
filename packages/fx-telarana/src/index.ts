/**
 * @bufi/fx-telarana — SDK + service layer for the FX Telaraña money market.
 *
 * Ported from fx-telarana/packages/fx-telarana. Owns the read surface
 * (markets, positions, oracle, quotes), the EIP-712 intent builders, an
 * in-memory intent store with nonce + signature verification, and a small
 * legacy service façade for downstream agent code that hasn't migrated yet.
 *
 * Hubs:
 *   - Fuji (43113)   — primary lending substrate
 *   - Arc  (5042002) — trading-execution hub also running Morpho markets
 */

export * from "./chains";
export * from "./clients";
export * from "./constants";
export * from "./fxSwap";
export * from "./errors";
export * from "./intent-verification";
export * from "./intents";
export * from "./intent-store";
export * from "./liquidations";
export * from "./market-view";
export { MorphoBlueAbi } from "./morpho-blue-abi";
export * from "./morpho-math";
export * from "./oracle";
export * from "./positions";
export * from "./quote-engine";
export * from "./schemas";
export * from "./service";
export * from "./tvl";
export * from "./types";

export type { FxLoanPosition, LoanStatus, MarketRegistryEntry } from "@bufi/shared-types";
