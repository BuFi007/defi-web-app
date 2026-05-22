// SPDX-License-Identifier: Apache-2.0
// FX² Arcade (FX Bento) contract registry — ABIs + per-chain deployment addresses.
// Ported from fx-bento monorepo's `@bufinance/fx-bento-contracts` package.
//
// Address values are also mirrored in ../deployments/bento-{network}.json
// for indexer / deploy tooling that prefers JSON manifests. Keep them in
// sync if you touch either source.
//
// We expose the address registry separately from the existing `CONTRACTS`
// graph in `./index.ts` so the consolidation step can decide whether to
// merge them. The Bento engine (`@bufi/fx-bento`) reads from this module.

import type { Abi, Address } from "viem";

import { FxBentoCommitmentManagerAbi } from "./abis/FxBentoCommitmentManager";
import { FxBentoHookAbi } from "./abis/FxBentoHook";
import { FxBentoPoolRegistryAbi } from "./abis/FxBentoPoolRegistry";
import { FxBentoProtocolFeeVaultAbi } from "./abis/FxBentoProtocolFeeVault";
import { FxBentoRoomEscrowAbi } from "./abis/FxBentoRoomEscrow";
import { FxBentoRoomFactoryAbi } from "./abis/FxBentoRoomFactory";
import { FxBentoRoundManagerAbi } from "./abis/FxBentoRoundManager";
import { FxBentoScoringAbi } from "./abis/FxBentoScoring";
import { FxBentoSettlementManagerAbi } from "./abis/FxBentoSettlementManager";
import { FxSwapHookAbi } from "./abis/FxSwapHook";
import { TelaranaGatewayHubHookAbi } from "./abis/TelaranaGatewayHubHook";

export type BentoContractName =
  | "FXBentoCommitmentManager"
  | "FXBentoHook"
  | "FXBentoRoomEscrow"
  | "FXBentoRoomFactory"
  | "FXBentoRoundManager"
  | "FXBentoScoring"
  | "FXBentoSettlementManager"
  | "PoolRegistry"
  | "ProtocolFeeVault";

export type BentoContractAddresses = Partial<Record<BentoContractName, Address>>;
export type BentoChainContractAddresses = Record<string, BentoContractAddresses>;

export const BENTO_CONTRACT_NAMES: readonly BentoContractName[] = [
  "FXBentoCommitmentManager",
  "FXBentoHook",
  "FXBentoRoomEscrow",
  "FXBentoRoomFactory",
  "FXBentoRoundManager",
  "FXBentoScoring",
  "FXBentoSettlementManager",
  "PoolRegistry",
  "ProtocolFeeVault",
] as const;

export const BENTO_ABIS = {
  FXBentoCommitmentManager: FxBentoCommitmentManagerAbi,
  FXBentoHook: FxBentoHookAbi,
  FXBentoRoomEscrow: FxBentoRoomEscrowAbi,
  FXBentoRoomFactory: FxBentoRoomFactoryAbi,
  FXBentoRoundManager: FxBentoRoundManagerAbi,
  FXBentoScoring: FxBentoScoringAbi,
  FXBentoSettlementManager: FxBentoSettlementManagerAbi,
  PoolRegistry: FxBentoPoolRegistryAbi,
  ProtocolFeeVault: FxBentoProtocolFeeVaultAbi,
} as const satisfies Record<BentoContractName, Abi>;

/**
 * v4-periphery surface that lives next to the Bento PoolManager. These are
 * the contracts the demo flows route swaps through — separate from the
 * BentoContractName union because they belong to the wider FX Telaraña
 * stack and may live in a sibling deploy manifest (`fx-telarana/deployments`).
 *
 * `FxSwapHook` / `TelaranaGatewayHubHook` are Wave M1 Uniswap v4 hooks
 * deployed on Arc Testnet 2026-05-21 (see memory `reference_arc_addresses.md`).
 * `V4SwapRouter` is the periphery router used by demo scripts to call
 * `PoolManager.unlock` → `swap` from an EOA (Universal Router is not yet
 * deployed on Arc Testnet; PoolSwapTest from v4-periphery is the canonical
 * fallback). Address is `null` until M3 deploys the router from the
 * sibling fx-telarana repo; M4 demos read it via env var
 * `V4_SWAP_ROUTER_<CHAINID>` until pinned here.
 */
export interface BentoV4PeripheryAddresses {
  FxSwapHook?: Address;
  TelaranaGatewayHubHook?: Address;
  /** PoolSwapTest router OR a custom FxSwapRouter forwarder. Read via env
   *  `V4_SWAP_ROUTER_<CHAINID>` until pinned here (Wave M3 follow-up). */
  V4SwapRouter?: Address;
}

export interface BentoDeploymentArtifact {
  network: string;
  chainId: number;
  rpcUrl: string;
  contractsCommit: string;
  treasury: Address;
  indexerStartBlock: number;
  poolManagerStartBlock: number;
  addresses: BentoContractAddresses & { PoolManager?: Address };
  /** v4 periphery + Wave M1 hooks. Optional so non-Arc chains stay
   *  backward-compatible. */
  v4Periphery?: BentoV4PeripheryAddresses;
}

export const BENTO_ARC_TESTNET_DEPLOYMENT: BentoDeploymentArtifact = {
  network: "arc-testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  contractsCommit: "dcd025f035b69eef0dccdb3e479b5336868f6356",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 42625070,
  poolManagerStartBlock: 42624882,
  addresses: {
    PoolManager: "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34",
    PoolRegistry: "0x4d17c86866e6f0eab4908fe4cb4592e56e361084",
    ProtocolFeeVault: "0x468c241484f6aa6bd9555c9533074510dc7d6df1",
    FXBentoHook: "0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0",
    FXBentoRoomFactory: "0x385bbd57d0dc2008e4446af7b12dcd158d56034d",
    FXBentoRoomEscrow: "0xab2f146507854334464c4b2326654775d9d947ed",
    FXBentoRoundManager: "0xfb956d033b15276da21579afd5f5b6bf6320869e",
    FXBentoSettlementManager: "0x8f635571aaea4b1391534cd92932caa839e04bcd",
    FXBentoCommitmentManager: "0x6b2c047fa0deb963a9ede1db7d0e4df258880414",
  },
  v4Periphery: {
    // FX Telaraña Wave M1 — deployed 2026-05-21 via CREATE2 (salt-mined
    // against the Uniswap v4 BEFORE_SWAP / AFTER_SWAP / ADD_LIQ flags).
    // Source: fx-telarana@feat/wave-m1-deploy-arc-hooks deployments/arc-testnet.json.
    // PermissionFlags 0xAC8: beforeAddLiquidity | beforeRemoveLiquidity |
    // beforeSwap | afterSwap | beforeSwapReturnDelta.
    FxSwapHook: "0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8",
    // PermissionFlags 0x88: beforeSwap | beforeSwapReturnDelta. Hooks
    // Circle Gateway mint-context proofs (Hyperlane-relayed) into the
    // PoolManager swap path so a single tx can pull liquidity from a
    // remote chain and execute the swap atomically.
    TelaranaGatewayHubHook: "0xe895CB461AFF6E98167a7FA0Db252ba906714088",
    // fx-telarana FxV4RouterHarness (contracts/test/utils/FxV4RouterHarness.sol).
    // PMM-aware: settles user input BEFORE manager.swap, which is what
    // FxSwapHook's PMM custom-accounting shape requires — beforeSwap
    // pulls the specified input out of PoolManager via
    // inputCurrency.take(POOL_MANAGER, hook, amountIn) at FxSwapHook.sol L731,
    // so the input MUST already be settled into PoolManager before
    // manager.swap fires.
    //
    // Replaces the Wave N2a PoolSwapTest pin (0x60004B…11fa, tx
    // 0xfcc77cb2…d39f) which settled AFTER manager.swap — incompatible
    // with FxSwapHook, verified by N3's reverted swap artefact
    // 0xde83acb7…62f6. PoolSwapTest is kept on-chain (and surfaced in
    // fx-telarana arc-testnet.json under PoolSwapTest_deprecated) for
    // v4-LP-shape pools without PMM hooks.
    //
    // Wave N4 deploy on Arc Testnet, tx 0xedf26e79…17c4. Closes N3's
    // swap-leg revert. The env-var fallback (V4_SWAP_ROUTER_5042002)
    // still works as an override for ops experimenting with a custom
    // router.
    V4SwapRouter: "0x7cfc449B9A6777F740b2F8F7BA87351B15A4B3b6",
  },
} as const;

export const BENTO_AVALANCHE_FUJI_DEPLOYMENT: BentoDeploymentArtifact = {
  network: "avalanche-fuji",
  chainId: 43113,
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  contractsCommit: "dcd025f035b69eef0dccdb3e479b5336868f6356",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 55454938,
  poolManagerStartBlock: 55454914,
  addresses: {
    PoolManager: "0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C",
    PoolRegistry: "0x2931c50745334d6dff9ec4e3106fe05b49717df1",
    ProtocolFeeVault: "0x7ac83373c6b74c7c5b0eee80fb36239a451dc899",
    FXBentoHook: "0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0",
    FXBentoRoomFactory: "0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1",
    FXBentoRoomEscrow: "0x5d10d2c3b9951054845534b2f60a68ebc0898cd3",
    FXBentoRoundManager: "0x27dbda42adb904115cade37c949bbf670e0ff09d",
    FXBentoSettlementManager: "0xa73208b62af9a87fb5e2b694b27f510d70e17746",
    FXBentoCommitmentManager: "0xaad184861726627968718fde8b94ecac87eb5c5b",
  },
} as const;

export const BENTO_DEPLOYMENTS: Record<number, BentoDeploymentArtifact> = {
  [BENTO_ARC_TESTNET_DEPLOYMENT.chainId]: BENTO_ARC_TESTNET_DEPLOYMENT,
  [BENTO_AVALANCHE_FUJI_DEPLOYMENT.chainId]: BENTO_AVALANCHE_FUJI_DEPLOYMENT,
};

export function getBentoDeployment(chainId: number): BentoDeploymentArtifact | null {
  return BENTO_DEPLOYMENTS[chainId] ?? null;
}

export function getBentoAddresses(chainId: number): BentoContractAddresses {
  const deployment = getBentoDeployment(chainId);
  if (!deployment) return {};
  const addresses: BentoContractAddresses = {};
  for (const name of BENTO_CONTRACT_NAMES) {
    const value = deployment.addresses[name];
    if (value) addresses[name] = value;
  }
  return addresses;
}

export function getBentoAddress(chainId: number, name: BentoContractName): Address | null {
  return getBentoAddresses(chainId)[name] ?? null;
}

export function getBentoRpcUrl(chainId: number): string | undefined {
  return getBentoDeployment(chainId)?.rpcUrl;
}

export function getBentoIndexerStartBlock(chainId: number): number | undefined {
  return getBentoDeployment(chainId)?.indexerStartBlock;
}

/**
 * v4 periphery addresses for a given chain. Returns an empty object when
 * none are pinned yet (non-Arc chains today). M4 demo scripts should
 * prefer the pinned address; fall back to env `V4_SWAP_ROUTER_<CHAINID>`
 * when `V4SwapRouter` is undefined.
 */
export function getBentoV4Periphery(chainId: number): BentoV4PeripheryAddresses {
  return getBentoDeployment(chainId)?.v4Periphery ?? {};
}

/**
 * Resolve the FxSwapHook address for `chainId`, or `null` if not deployed.
 * Wave M1 deployed this on Arc Testnet 2026-05-21.
 */
export function getFxSwapHookAddress(chainId: number): Address | null {
  return getBentoV4Periphery(chainId).FxSwapHook ?? null;
}

/**
 * Resolve the TelaranaGatewayHubHook address for `chainId`, or `null` if
 * not deployed. Wave M1 deployed this on Arc Testnet 2026-05-21.
 */
export function getTelaranaGatewayHubHookAddress(chainId: number): Address | null {
  return getBentoV4Periphery(chainId).TelaranaGatewayHubHook ?? null;
}

/**
 * Resolve the v4 periphery swap router (PoolSwapTest or FxSwapRouter
 * forwarder) for `chainId`. Falls back to env var
 * `V4_SWAP_ROUTER_<CHAINID>` so the M4 demo broadcast can run while the
 * pin lands in a follow-up. Returns `null` when neither is configured.
 *
 * Universal Router is the preferred entry point per the v4 SDK guide
 * (see ~/.claude/skills/v4-sdk-integration/SKILL.md) but is NOT deployed
 * on Arc Testnet (chainId 5042002) per
 * https://developers.uniswap.org/contracts/v4/deployments — checked
 * 2026-05-21, only the 18 mainnets + 6 testnets listed there carry one,
 * Arc isn't among them. Until a Universal Router lands or fx-telarana
 * Wave M3 broadcasts PoolSwapTest, demo scripts route EOA swaps through
 * this address.
 */
export function getV4SwapRouterAddress(chainId: number): Address | null {
  const pinned = getBentoV4Periphery(chainId).V4SwapRouter;
  if (pinned) return pinned;
  const envValue = process.env[`V4_SWAP_ROUTER_${chainId}`];
  if (envValue && /^0x[0-9a-fA-F]{40}$/.test(envValue)) {
    return envValue as Address;
  }
  return null;
}

export {
  FxBentoCommitmentManagerAbi,
  FxBentoHookAbi,
  FxBentoPoolRegistryAbi,
  FxBentoProtocolFeeVaultAbi,
  FxBentoRoomEscrowAbi,
  FxBentoRoomFactoryAbi,
  FxBentoRoundManagerAbi,
  FxBentoScoringAbi,
  FxBentoSettlementManagerAbi,
  FxSwapHookAbi,
  TelaranaGatewayHubHookAbi,
};
