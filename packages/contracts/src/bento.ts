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

export interface BentoDeploymentArtifact {
  network: string;
  chainId: number;
  rpcUrl: string;
  contractsCommit: string;
  treasury: Address;
  indexerStartBlock: number;
  poolManagerStartBlock: number;
  addresses: BentoContractAddresses & { PoolManager?: Address };
}

export const BENTO_ARC_TESTNET_DEPLOYMENT: BentoDeploymentArtifact = {
  network: "arc-testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.drpc.testnet.arc.network",
  contractsCommit: "c9d58bd36ba6f5580bf3eac8195c31ed568c2520",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 44364271,
  poolManagerStartBlock: 42624882,
  addresses: {
    PoolManager: "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34",
    PoolRegistry: "0xa9e3cd0414daffd78389e81465678b9fefd00155",
    ProtocolFeeVault: "0xc2f2b13d3897b8362ec50d2e2f3ae98943ec15d2",
    FXBentoHook: "0x93efea7a2dfa566bcc5f2d5befb993a08c6c10c0",
    FXBentoRoomFactory: "0x0fb6e92f4aa9e7fe22deab46e5ed8b7f39d66744",
    FXBentoRoomEscrow: "0x87eee7b6523ab6d06edd9a25f070390cb0dc1042",
    FXBentoRoundManager: "0x5474f12c1889f48979d6108dd3bd541617d30f8f",
    FXBentoSettlementManager: "0xd83de41adbdb9e8015ebeda73dc76295627dfcd4",
    FXBentoCommitmentManager: "0xc1e71810014b536f2e70c57170da3952411ef726",
  },
} as const;

export const BENTO_AVALANCHE_FUJI_DEPLOYMENT: BentoDeploymentArtifact = {
  network: "avalanche-fuji",
  chainId: 43113,
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  contractsCommit: "c9d58bd36ba6f5580bf3eac8195c31ed568c2520",
  treasury: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  indexerStartBlock: 55842655,
  poolManagerStartBlock: 55454914,
  addresses: {
    PoolManager: "0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C",
    PoolRegistry: "0x4fb46362f6d89f15586c90afb531ccec7052e1ae",
    ProtocolFeeVault: "0x8d601d328a5f090bd11d5a29a538ea23d33f71d9",
    FXBentoHook: "0x604320333c7f03c0fc403ebf98cf79ff0159d0c0",
    FXBentoRoomFactory: "0x63b65f16c8f15f95ae7c92b3ad5e96cd6bf63204",
    FXBentoRoomEscrow: "0x45220a73e4bf3a990d48501fb13b2d159bd15037",
    FXBentoRoundManager: "0xaa63932630b2b50ed2d6046876cb64a9fe3eb897",
    FXBentoSettlementManager: "0x1e3fffcb2fd7d5e5bc3692f0af5ee77144120245",
    FXBentoCommitmentManager: "0xf93834070e4e4e7ff0e161feca2aeba65c2c6a38",
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
};
