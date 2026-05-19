"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ReactNode, useEffect } from "react";
import { DYNAMIC_ENVIRONMENT_ID } from "@/constants/Env";
import {
  ArbitrumSepolia,
  ArcTestnet,
  Avalanche,
  AvalancheFuji,
  Sepolia,
} from "@/constants/Chains";
import {
  DynamicErrorBoundary,
  installDynamicRejectionFilter,
} from "./DynamicErrorBoundary";
import { DevWalletProvider } from "@/lib/dev-wallet";
import { SessionBridge } from "@/lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();
// IMPORTANT: Avalanche C-Chain mainnet (43114) is allow-listed here ONLY so
// that Dynamic's networkValidationMode: "always" doesn't reject the wallet
// when a user's MetaMask is sitting on AVAX mainnet at login. The wagmi
// config (lib/wagmi.ts) still only includes [avalancheFuji, arcTestnet], so
// production trading stays on Fuji + Arc — Avalanche mainnet is presented to
// the user as a recognised network for the auth handshake only. Without it,
// switching to mainnet AVAX during login fires the misleading "Please unlock
// your wallet extension and try again." overlay because Dynamic panics on
// an unknown chain id.
// Hubs + spoke chains. Order matters — first entries are the WalletConnect
// preferred chains, so we keep the hubs (where trading executes) ahead of
// the spokes (where users hold collateral). Avalanche mainnet stays last
// since it's auth-handshake-only, not a trading target.
const evmNetworks = [
  AvalancheFuji,
  ArcTestnet,
  Sepolia,
  ArbitrumSepolia,
  Avalanche,
];
// Preferred chains for the WalletConnect handshake — keep ordered with our
// primary testnets first so the wallet defaults to a chain we actually
// transact on, while still recognising AVAX mainnet at login.
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
            // Unwrap the Error to plain fields — `console.error(obj)` was
            // printing `[object Error]` and hiding the real message/code,
            // which made diagnosis impossible from console alone.
            const err = error as
              | (Error & { code?: number; data?: unknown })
              | undefined;
            console.error("Dynamic wallet connection failed", {
              wallet: walletConnector?.name,
              chainId: walletConnector?.connectedChain,
              message: err?.message,
              code: err?.code,
              name: err?.name,
              stack: err?.stack?.split("\n").slice(0, 4).join("\n"),
              data: err?.data,
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
          <DynamicWagmiConnector>
            <DevWalletProvider>
              {/* SessionBridge is the ONE place that writes to the BufiSession
                  store. Mounted here so wagmi + Dynamic hooks resolve. No
                  signing happens here — that's lib/session/use-ensure-session. */}
              <SessionBridge />
              {/* TooltipProvider is required by every Radix Tooltip in the
                  tree. delayDuration: 200ms matches desk-v1's feel. */}
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            </DevWalletProvider>
          </DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
    </DynamicErrorBoundary>
  );
}
