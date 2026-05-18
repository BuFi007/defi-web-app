/**
 * Runtime hex helpers shared across the stack. Pure functions, no zod.
 * Importable from zod-free packages (e.g. ponder handlers) without
 * dragging the schema runtime along.
 */

/** Lower-case a 0x-prefixed hex string, preserving the branded type.
 *  Used wherever we key on an address or hash in storage / cache keys
 *  to dodge case-mismatch lookups. */
export function lowerHex<T extends string>(value: T): T {
  return value.toLowerCase() as T;
}

/** Same as `lowerHex` but allows null/undefined passthrough. When
 *  `treatZeroAsNull` is true (default false), the all-zero hex sentinel
 *  (`0x000…`, any length) also returns null — useful for handlers where
 *  contracts use `bytes32(0)` to mean "no metadata / unset slot". */
export function lowerHexOrNull<T extends string>(
  value: T | null | undefined,
  options: { treatZeroAsNull?: boolean } = {},
): T | null {
  if (!value) return null;
  if (options.treatZeroAsNull && /^0x0+$/i.test(value)) return null;
  return value.toLowerCase() as T;
}
