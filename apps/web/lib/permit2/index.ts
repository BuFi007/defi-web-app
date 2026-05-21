/**
 * Permit2 module entrypoint. Re-exports the public surface so call sites
 * import from `@/lib/permit2` without reaching into specific files.
 *
 * Composition target — see ./README.md for the call-site sketch that
 * pairs these hooks with `useSimulatedWrite` (PR #44) and
 * `useOptimisticPlaceOrder` (PR #49).
 */

export {
  PERMIT2_ADDRESS,
  PERMIT2_DOMAIN_NAME,
  PERMIT2_NONCE_BITS_PER_WORD,
  ALLOWANCE_EXPIRATION_DEFAULTS,
} from "./constants";

export {
  buildPermit2Domain,
  buildPermitSingleTypedData,
  buildPermitTransferFromTypedData,
  type PermitSingleTypedData,
  type PermitTransferFromTypedData,
} from "./typed-data";

export {
  PERMIT_DETAILS_TYPE,
  PERMIT_SINGLE_TYPE,
  PERMIT_TRANSFER_FROM_TYPE,
  TOKEN_PERMISSIONS_TYPE,
  type PermitDetails,
  type PermitSingleArgs,
  type PermitSingleMessage,
  type PermitTransferFromArgs,
  type PermitTransferFromMessage,
  type SignedPermitSingle,
  type SignedPermitTransferFrom,
  type TokenPermissions,
} from "./types";

export {
  resolvePermit2Router,
  isPermit2RouterAvailable,
  permit2RouterEnvKey,
} from "./router";

export {
  usePermit2Signature,
  type UsePermit2SignatureResult,
} from "./use-permit-signature";

export {
  nextPermit2Nonce,
  lowestUnsetBit,
  decodeNonceFromBitmap,
  Permit2NonceExhaustedError,
  PERMIT2_NONCE_BITMAP_ABI,
  type NextPermit2NonceArgs,
} from "./next-nonce";
