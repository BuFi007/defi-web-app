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
    FxFundingEngine: "0x88B70872759E1aA24858746779Cb15ca9F2cdcf3",
    FxHealthChecker: "0x272305e821D810eC5741761F98DbDC273efD47E6",
    FxLiquidationEngine: "0xD384560E5f8CE969BF4C1BDfAFACc5304AFbe8f2",
    FxMarginAccount: "0x35c7cD02cFa0c2889547482B71c1a5114d8439C6",
    FxOrderSettlement: "0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1",
    FxPerpClearinghouse: "0x6A265045D9A3291D2881d77DDC62e2781A2418c5",
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
