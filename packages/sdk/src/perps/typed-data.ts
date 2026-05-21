/**
 * EIP-712 typed-data helpers for BUFI perps.
 *
 * Pure re-exports from `@bufi/perps` — the same builders the keeper and API
 * use internally. Integrators sign the output with viem's `signTypedData`.
 *
 * @example
 * ```ts
 * import { buildPerpsOrderTypedData } from "@bufi/sdk/perps/typed-data";
 * import { signTypedData } from "viem/actions";
 *
 * const typed = buildPerpsOrderTypedData({
 *   chainId: 5042002,
 *   trader: "0xabc…",
 *   marketId: "0x565a…",
 *   side: "long",
 *   orderType: "market",
 *   sizeUsdc: "10",
 *   leverage: 5,
 *   reduceOnly: false,
 *   nonce: "0",
 *   deadline: Math.floor(Date.now() / 1000) + 600,
 * });
 *
 * const signature = await signTypedData(walletClient, typed);
 * ```
 */

export {
  PERPS_ORDER_DOMAIN,
  PERPS_ORDER_TYPES,
  SIGNED_ORDER_TYPES,
  buildPerpsOrderTypedData,
  buildSignedOrderMessage,
  hashPerpsOrder,
  orderFlags,
  orderTypeCode,
  parseUsdcToAtomic,
  signedSizeDelta,
  verifyPerpsOrderSignature,
} from "@bufi/perps";
export type {
  PerpsOrderKind,
  PerpsOrderTypedDataInput,
  PerpsTypedData,
  SignedOrderMessage,
} from "@bufi/perps";
