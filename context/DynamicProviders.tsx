"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ReactNode } from "react";
import { DYNAMIC_ENVIRONMENT_ID } from "@/constants/Env";
import {
  Avalanche,
  Base,
  BaseSepolia,
  AvalancheFuji,
  BscTestnet,
} from "@/constants/Chains";

const queryClient = new QueryClient();
const evmNetworks = [Avalanche, Base, BaseSepolia, AvalancheFuji, BscTestnet];

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors as any],
        overrides: {
          evmNetworks: evmNetworks.map((network) => ({
            ...network,
            iconUrls: network.iconUrls,
          })),
        },
      }}
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>{children}</DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  );
}
