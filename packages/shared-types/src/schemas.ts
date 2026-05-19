/**
 * Regex constants for the hex primitives every package validates against.
 * Exported as plain RegExp (not zod schemas) on purpose — when zod schemas
 * are re-exported across packages, TypeScript treats the `z.ZodString`
 * instances as nominally distinct and z.infer on any z.object that mixes
 * them collapses to `{ [k]: unknown }`. Wrapping locally inside each
 * package's own `z.string().regex(...)` keeps the type identity clean.
 *
 * Why centralize the regex at all: every consumer (perps, mcp, fx-spot,
 * fx-telarana, env) had its own copy that drifted on the bytes32 variant
 * (some used `[0-9a-fA-F]`, some `[a-fA-F0-9]`, some allowed lowercase
 * only). One source of truth here prevents future drift.
 */

/** ERC-20 / EOA address: 0x + 40 hex chars. Case-insensitive. */
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** Arbitrary hex blob (signatures, calldata). 0x + ≥1 hex char. */
export const HEX_REGEX = /^0x[a-fA-F0-9]+$/;

/** 32-byte hash: 0x + 64 hex chars. Tx hashes, intent digests, salts. */
export const BYTES32_REGEX = /^0x[a-fA-F0-9]{64}$/;
