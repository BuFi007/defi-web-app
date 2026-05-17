/**
 * @bufi/perps owns the backend surface around Phase B-E perpetuals.
 *
 * The package deliberately does not re-implement funding, liquidation, or
 * pricing math. Quotes go through an injected on-chain reader, and signed
 * orders are verified against EIP-712 typed data before they are persisted
 * for the matcher keeper.
 */

export * from "./schemas";
export * from "./service";
export * from "./typed-data";
export * from "./onchain";
export * from "./markets";
export * from "./orderbook";
export * from "./replacement-events";
