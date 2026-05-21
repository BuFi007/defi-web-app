/**
 * Barrel for the perps high-level flows.
 *
 * Composes the REST client + EIP-712 typed-data + viem `WalletClient` into
 * one-shot functions integrators call directly: `openPerp`, `closePerp`,
 * `depositMargin`, `placeLimitOrder`, etc.
 */

export * from "./open";
export * from "./close";
export * from "./margin";
export * from "./orders";
export * from "./typed-data";
