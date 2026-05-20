/**
 * Contract addresses and ABI registry for the BUFI protocol.
 *
 * Thin re-export shape over `@bufi/contracts` — the internal package exports
 * everything (per-chain manifests, ABIs, market metadata), and this module
 * surfaces the integrator-relevant subset.
 *
 * Use {@link getContracts} to fetch the per-chain address manifest, or
 * import an ABI directly (e.g., `FxPerpClearinghouseAbi`) to call a contract
 * with `viem`'s `readContract` / `writeContract`.
 */

import {
  CONTRACTS,
  ARC_PERP_MARKETS,
  BUFX_PROTOCOL_PERP_MARKETS,
  CIRCLE_GATEWAY,
  PYTH_FEED_IDS,
  SPOT_FX_ROUTES,
  getContracts as _getContracts,
  loadContracts,
} from "@bufi/contracts";

import type { ChainContracts, PerpsContracts } from "@bufi/contracts";
import type { ChainId } from "@bufi/shared-types";

import { UnsupportedChainError } from "./errors";

export {
  ARC_PERP_MARKETS,
  BUFX_PROTOCOL_PERP_MARKETS,
  CIRCLE_GATEWAY,
  CONTRACTS,
  PYTH_FEED_IDS,
  SPOT_FX_ROUTES,
  loadContracts,
};

export type {
  ChainContracts,
  PerpsContracts,
};

/**
 * Return the contract address manifest for a single chain.
 *
 * Reads from `process.env.CONTRACT_ADDRESSES_JSON` if set (used by keepers
 * pointing at primed Tenderly forks); otherwise returns the static
 * production manifest.
 *
 * @throws {UnsupportedChainError} if the chain id is not in the manifest.
 */
export function getContracts(chainId: ChainId): ChainContracts {
  const manifest = _getContracts(chainId);
  if (!manifest) throw new UnsupportedChainError(chainId as number);
  return manifest;
}

/**
 * Return the perps subset of the manifest for a chain — `clearinghouse`,
 * `marginAccount`, `orderSettlement`, `fundingEngine`, etc.
 *
 * Throws if perps contracts are not yet deployed on the given chain.
 */
export function getPerpsContracts(chainId: ChainId): Required<Pick<PerpsContracts, "clearinghouse" | "marginAccount" | "orderSettlement">> & PerpsContracts {
  const perps = getContracts(chainId).perps;
  if (!perps.clearinghouse || !perps.marginAccount || !perps.orderSettlement) {
    throw new Error(
      `perps contracts are not deployed on chain ${chainId} (missing clearinghouse / marginAccount / orderSettlement)`,
    );
  }
  return perps as Required<Pick<PerpsContracts, "clearinghouse" | "marginAccount" | "orderSettlement">> & PerpsContracts;
}

// ABIs the integrator is most likely to need — re-exported for ergonomic
// imports (`import { FxPerpClearinghouseAbi } from "@bufi/sdk/contracts"`).
// The full ABI catalogue is reachable through the `@bufi/contracts` package
// for advanced integrators.
export {
  FxFundingEngineAbi,
  FxHealthCheckerAbi,
  FxLiquidationEngineAbi,
  FxMarginAccountAbi,
  FxMarketRegistryAbi,
  FxOracleAbi,
  FxOrderSettlementAbi,
  FxPerpClearinghouseAbi,
  FxPerpMarketAbi,
} from "@bufi/contracts";
