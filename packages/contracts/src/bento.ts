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
