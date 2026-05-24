/**
 * Per-perp-hub manifest for the trade-island UI.
 *
 * Composes:
 *   - `HUBS` from @bufi/location/hubs (single source of truth for chain
 *     id / name / colour / icon)
 *   - The Arc perp clearinghouse + funding engine addresses from
 *     `@bufi/contracts` (via the `Perps` namespace re-export at
 *     packages/contracts/src/perps-deployments.ts).
 *   - The Fuji per-hub market list mirrored verbatim from fx-telarana
 *     PR #28 (`packages/sdk/src/perps.ts`). Fuji addresses are not yet
 *     deployed — the manifest below carries placeholder zero addresses
 *     and the UI gates Fuji surfaces behind a feature flag.
 *
 * Why mirror the constants here instead of patching @bufi/contracts:
 *   This worktree intentionally avoids edits to the shared contracts
 *   package because (a) Wave D and the contracts agent both touch it
 *   on overlapping branches, and (b) the wk1d3-multichain-perps
 *   surface should be self-contained so the UI changes can land
 *   independently of the broadcast. When the Fuji deploy lands and
 *   the contracts package is updated, we delete the placeholder map
 *   below and re-import from `@bufi/contracts.Perps`.
 */

import {
  HUBS,
  HUB_LIST,
  HUB_CHAIN_IDS,
  type HubChain,
  type HubChainId,
} from "@bufi/location/hubs";
import { Perps } from "@bufi/contracts";
import type { Address } from "viem";

export type PerpsChainId = HubChainId;

/**
 * Market-key listings per perps hub. Mirrored from fx-telarana PR #28
 * (`packages/sdk/src/perps.ts`). These are SYMBOL keys, not bytes32
 * marketIds — the on-chain marketId is derived per deployment.
 */
export const ARC_FX_PERP_MARKET_KEYS = [
  "EURC_USDC",
  "TJPYC_USDC",
  "TMXNB_USDC",
  "TCHFC_USDC",
] as const;

export const FUJI_FX_PERP_MARKET_KEYS = ["EURC_USDC", "MXNB_USDC"] as const;

export const ALL_FX_PERP_MARKET_KEYS = [
  ...ARC_FX_PERP_MARKET_KEYS,
  ...FUJI_FX_PERP_MARKET_KEYS,
] as const;

export type FxPerpMarketKey =
  | (typeof ARC_FX_PERP_MARKET_KEYS)[number]
  | (typeof FUJI_FX_PERP_MARKET_KEYS)[number];

/**
 * Minimum keeper-flag → finalize delay enforced by FxLiquidationEngine on
 * the Fuji deployment (per fx-telarana PR #28). Surfaced for the
 * liquidation countdown UI when Wave B wires it in.
 */
export const MIN_LIQUIDATION_FLAG_DELAY = 60n;

const PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

interface PerpsAddressMap {
  clearinghouse: Address;
  fundingEngine: Address;
}

const FUJI_PERPS_PLACEHOLDER: PerpsAddressMap = {
  clearinghouse: PLACEHOLDER_ADDRESS,
  fundingEngine: PLACEHOLDER_ADDRESS,
};

function arcAddresses(): PerpsAddressMap {
  return {
    clearinghouse:
      (Perps.getPerpsContractAddress(5042002, "FxPerpClearinghouse") ?? PLACEHOLDER_ADDRESS) as Address,
    fundingEngine:
      (Perps.getPerpsContractAddress(5042002, "FxFundingEngine") ?? PLACEHOLDER_ADDRESS) as Address,
  };
}

function perpsAddressesForChain(chainId: PerpsChainId): PerpsAddressMap {
  if (chainId === 5042002) return arcAddresses();
  if (chainId === 43113) return FUJI_PERPS_PLACEHOLDER;
  return FUJI_PERPS_PLACEHOLDER;
}

function perpMarketKeysForChainLocal(
  chainId: PerpsChainId,
): readonly FxPerpMarketKey[] {
  if (chainId === 5042002) return ARC_FX_PERP_MARKET_KEYS;
  if (chainId === 43113) return FUJI_FX_PERP_MARKET_KEYS;
  return [];
}

function isContractsLive(chainId: PerpsChainId): boolean {
  const addr = perpsAddressesForChain(chainId);
  return addr.clearinghouse !== PLACEHOLDER_ADDRESS;
}

export interface PerpsChainManifest {
  hub: HubChain;
  chainId: PerpsChainId;
  marketKeys: readonly FxPerpMarketKey[];
  /** Whether the contracts are deployed AND the env flag (if any) is on. */
  enabled: boolean;
  /** Truthy when broadcast is pending — Fuji until the deploy lands. */
  pending: boolean;
  /** Tooltip / disabled-row explanation. `null` when fully enabled. */
  pendingReason: string | null;
  /** FxPerpClearinghouse address. Placeholder zero when not deployed. */
  clearinghouseAddress: Address;
  /** FxFundingEngine address. Placeholder zero when not deployed. */
  fundingEngineAddress: Address;
}

/**
 * `NEXT_PUBLIC_PERPS_FUJI_ENABLED` flips the Fuji-perps surfaces on once
 * the contracts are deployed. Default off keeps the chain selector
 * showing "Live soon" so accidentally clicking through doesn't trigger
 * a placeholder-address multicall (which would error noisily).
 */
export function fujiPerpsFeatureFlag(): boolean {
  return process.env.NEXT_PUBLIC_PERPS_FUJI_ENABLED === "true";
}

function manifestFor(hub: HubChain): PerpsChainManifest {
  const chainId = hub.chainId;
  const addr = perpsAddressesForChain(chainId);
  const marketKeys = perpMarketKeysForChainLocal(chainId);
  const contractsLive = isContractsLive(chainId);
  const flagOn = chainId === 43113 ? fujiPerpsFeatureFlag() : true;
  const enabled = contractsLive && flagOn && marketKeys.length > 0;
  const pending = !contractsLive && marketKeys.length > 0;
  const pendingReason = pending
    ? "Live soon — Fuji perps broadcast is pending. Trades will route here once the deploy lands."
    : !flagOn && chainId === 43113
      ? "Disabled. Set NEXT_PUBLIC_PERPS_FUJI_ENABLED=true to enable."
      : null;
  return {
    hub,
    chainId,
    marketKeys,
    enabled,
    pending,
    pendingReason,
    clearinghouseAddress: addr.clearinghouse,
    fundingEngineAddress: addr.fundingEngine,
  };
}

/** Stable-order list of perp hub manifests. Mirrors HUB_LIST ordering. */
export const PERPS_CHAINS: readonly PerpsChainManifest[] = HUB_LIST.map(manifestFor);

export const PERPS_CHAIN_BY_ID: Readonly<Record<PerpsChainId, PerpsChainManifest>> = Object.freeze(
  Object.fromEntries(PERPS_CHAINS.map((m) => [m.chainId, m] as const)),
) as Readonly<Record<PerpsChainId, PerpsChainManifest>>;

export function perpsChain(chainId: number): PerpsChainManifest | null {
  return PERPS_CHAIN_BY_ID[chainId as PerpsChainId] ?? null;
}

/**
 * Default chain when the user hasn't picked one yet. Arc has the deeper
 * registered-market list (4 vs. 2) and the live deploy, so it makes the
 * highest-utility default.
 */
export const DEFAULT_PERPS_CHAIN_ID: PerpsChainId = HUBS.arc.chainId;

/**
 * Read the `?perp_chain=<id>` URL param on the client. SSR returns
 * `null` so we don't bake the wrong default into hydration.
 */
export function perpChainFromSearchParams(
  search: URLSearchParams | null | undefined,
): PerpsChainId | null {
  if (!search) return null;
  const raw = search.get("perp_chain");
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isFinite(id)) return null;
  if (!HUB_CHAIN_IDS.includes(id as HubChainId)) return null;
  return id as PerpsChainId;
}

/** Helper exported so the position aggregator can fan out only over live chains. */
export function perpMarketKeysForChain(
  chainId: number,
): readonly FxPerpMarketKey[] {
  if (chainId !== 5042002 && chainId !== 43113) return [];
  return perpMarketKeysForChainLocal(chainId as PerpsChainId);
}
