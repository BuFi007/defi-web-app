"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ReactNode, useEffect } from "react";
import { DYNAMIC_ENVIRONMENT_ID } from "@/constants/Env";
import { ArcTestnet, AvalancheFuji } from "@/constants/Chains";
import {
  DynamicErrorBoundary,
  installDynamicRejectionFilter,
} from "./DynamicErrorBoundary";

const queryClient = new QueryClient();
const evmNetworks = [AvalancheFuji, ArcTestnet];
const walletConnectPreferredChains = evmNetworks.map(
  (network) => `eip155:${network.chainId}` as const
);

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    installDynamicRejectionFilter();
  }, []);

  return (
    <DynamicErrorBoundary>
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        networkValidationMode: "always",
        walletConnectPreferredChains,
        social: {
          strategy: "popup",
        },
        events: {
          onEmbeddedWalletCreated: (verifiedCredential, user) => {
            console.info("Dynamic embedded wallet created", {
              credentialFormat: verifiedCredential?.format,
              userId: user?.userId,
            });
          },
          onWalletAdded: ({ wallet, userWallets }) => {
            console.info("Dynamic wallet added", {
              address: wallet.address,
              chain: wallet.chain,
              walletCount: userWallets.length,
            });
          },
          onWalletConnectionFailed: (walletConnector, error) => {
            console.error("Dynamic wallet connection failed", {
              error,
              wallet: walletConnector.name,
            });
          },
        },
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
    </DynamicErrorBoundary>
  );
}
