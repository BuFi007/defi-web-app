import { defineChain } from "viem";
import type { Chain } from "viem";
import { avalancheFuji } from "viem/chains";

import {
  TELARANA_DEPLOYMENTS,
  getTelaranaRpcUrl,
  type TelaranaHubChainId,
  type TelaranaHubName,
} from "@bufi/contracts/telarana";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: ["https://rpc.drpc.testnet.arc.network", "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: {
      name: "Arc Testnet Explorer",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

export const FX_HUB_CHAINS: Record<TelaranaHubChainId, Chain> = {
  43113: avalancheFuji,
  5042002: arcTestnet,
};

export interface LendingHubConfig {
  name: TelaranaHubName;
  chainId: TelaranaHubChainId;
  label: string;
  marketRegistry: `0x${string}`;
  oracle: `0x${string}`;
  liquidator: `0x${string}`;
  morphoBlue: `0x${string}`;
  defaultRpcUrl: string;
}

export const LENDING_HUBS: readonly LendingHubConfig[] = (Object.entries(TELARANA_DEPLOYMENTS) as Array<
  [string, (typeof TELARANA_DEPLOYMENTS)[TelaranaHubChainId]]
>).map(([chainIdStr, deployment]) => {
  const chainId = Number(chainIdStr) as TelaranaHubChainId;
  return {
    name: deployment.hubName,
    chainId,
    label: deployment.hubLabel,
    marketRegistry: deployment.contracts.FxMarketRegistry,
    oracle: deployment.contracts.FxOracle,
    liquidator: deployment.contracts.FxLiquidator,
    morphoBlue: deployment.contracts.MorphoBlue,
    defaultRpcUrl: getTelaranaRpcUrl(chainId),
  };
});

export function hubByChainId(chainId: number): LendingHubConfig {
  const hub = LENDING_HUBS.find((candidate) => candidate.chainId === chainId);
  if (!hub) throw new Error(`Unsupported FX Telarana lending hub chainId ${chainId}`);
  return hub;
}

export function chainForHub(chainId: TelaranaHubChainId): Chain {
  return FX_HUB_CHAINS[chainId];
}

export function rpcUrlForHub(hub: LendingHubConfig): string {
  return getTelaranaRpcUrl(hub.chainId);
}
