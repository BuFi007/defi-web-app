// SPDX-License-Identifier: Apache-2.0
// Address book for the live Telarana perps stack. Mirrored from
// fx-telarana-protocol-main/deployments/perps-<chainId>.json and from the
// canonical JSON manifest at ../deployments/perps-arc-testnet.json. Keeping
// the literal map here as well lets ESM consumers import without relying on
// JSON import assertions (which are inconsistent across the Next.js + Bun +
// tsc matrix this monorepo runs).

import type { Address } from "viem";

export type PerpsContractName =
  | "FxFundingEngine"
  | "FxHealthChecker"
  | "FxLiquidationEngine"
  | "FxMarginAccount"
  | "FxOrderSettlement"
  | "FxPerpClearinghouse";

export interface PerpsDeployment {
  chainId: number;
  name: string;
  source: string;
  deployer?: Address;
  keeper?: Address;
  contracts: Record<PerpsContractName, Address>;
}

const ARC_TESTNET_PERPS: PerpsDeployment = {
  chainId: 5042002,
  name: "Arc Testnet",
  source: "fx-telarana-protocol-main/deployments/perps-5042002.json",
  deployer: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  keeper: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  contracts: {
    FxFundingEngine: "0xE08a146B9081A8dd32203fC5e7B5988352489518",
    FxHealthChecker: "0x234E06a0761cde322E4Fc5065A8256247669F362",
    FxLiquidationEngine: "0x18DEA7845c36d45AaDbcCeC04aC6cFc103748D80",
    FxMarginAccount: "0x77BBAef17257AD4800BE12A5D36AF87f3a49FBb7",
    FxOrderSettlement: "0xCeae7846c8ED2Dd9E6f541798a657875305EA0d8",
    FxPerpClearinghouse: "0x7707d108F6Ce3d95ceA38D3965448F00C21CaFdC",
  },
};

export const PERPS_DEPLOYMENTS = {
  [ARC_TESTNET_PERPS.chainId]: ARC_TESTNET_PERPS,
} as const satisfies Record<number, PerpsDeployment>;

export type PerpsDeploymentChainId = keyof typeof PERPS_DEPLOYMENTS;

export function getPerpsDeployment(chainId: number): PerpsDeployment | undefined {
  return (PERPS_DEPLOYMENTS as Record<number, PerpsDeployment>)[chainId];
}

export function getPerpsContractAddress(
  chainId: number,
  name: PerpsContractName,
): Address | undefined {
  return getPerpsDeployment(chainId)?.contracts[name];
}

export function requirePerpsContractAddress(
  chainId: number,
  name: PerpsContractName,
): Address {
  const address = getPerpsContractAddress(chainId, name);
  if (!address) {
    throw new Error(
      `@bufi/contracts: no ${name} address recorded for chainId ${chainId}`,
    );
  }
  return address;
}
