/**
 * Constants shared by the FX Telaraña lending SDK.
 *
 * - WAD / ORACLE_PRICE_SCALE / MAX_UINT_256 mirror Morpho-Blue's storage scale.
 * - MAX_INTENT_DEADLINE_SECONDS mirrors Circle Gateway's signer block window;
 *   we cap intent deadlines so the protocol-side burn-intent stays usable.
 */
export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const MAX_UINT_256 = (1n << 256n) - 1n;

export const GATEWAY_SIGNER_BLOCK_WINDOW = 7_200;
export const MAX_INTENT_DEADLINE_SECONDS = GATEWAY_SIGNER_BLOCK_WINDOW;

export const DEFAULT_QUOTE_STALE_AFTER_SECONDS = 120;
