/**
 * Chain config helpers for the BUFI SDK.
 *
 * Re-exports the supported chain id constants from `@bufi/contracts` and
 * provides a `getViemChain(chainId)` helper that returns the matching
 * `viem/chains` definition. Integrators using their own viem chain configs
 * can ignore this module entirely.
 */

import type { Chain } from "viem";
import {
  arcTestnet as arcTestnetViem,
  avalancheFuji as avalancheFujiViem,
} from "viem/chains";

import {
  CHAIN_IDS,
  DEFAULT_RPC_URLS,
  SUPPORTED_CHAIN_IDS,
  getRpcUrl,
} from "@bufi/contracts";
import type { ChainId } from "@bufi/shared-types";

import { UnsupportedChainError } from "./errors";

export {
  CHAIN_IDS,
  DEFAULT_RPC_URLS,
  SUPPORTED_CHAIN_IDS,
  getRpcUrl,
};

export type { ChainId };

/**
 * Map a BUFI-supported chain id to its viem `Chain` definition.
 *
 * @throws {UnsupportedChainError} if the chain id is not in
 *   {@link SUPPORTED_CHAIN_IDS}.
 *
 * @example
 * ```ts
 * import { getViemChain } from "@bufi/sdk/chains";
 * import { createWalletClient, http } from "viem";
 *
 * const walletClient = createWalletClient({
 *   chain: getViemChain(5042002),
 *   transport: http(),
 * });
 * ```
 */
export function getViemChain(chainId: ChainId): Chain {
  switch (chainId) {
    case 5042002:
      return arcTestnetViem;
    case 43113:
      return avalancheFujiViem;
    default:
      throw new UnsupportedChainError(chainId as number);
  }
}

/**
 * Viem chain config for Arc Testnet (chain id `5042002`). The BUFI perps
 * contracts live here.
 */
export const arcTestnet = arcTestnetViem;

/**
 * Viem chain config for Avalanche Fuji (chain id `43113`). Bridge source for
 * the `BUFX` cross-chain settlement flow.
 */
export const avalancheFuji = avalancheFujiViem;
