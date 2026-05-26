import { http, createConfig, useConnectorClient, Config } from "wagmi";
import {
  avalanche,
  avalancheFuji,
  arcTestnet,
  mainnet,
  sepolia,
  arbitrumSepolia,
} from "wagmi/chains";
import { getDefaultConfig } from "connectkit";
import { useMemo } from "react";
import { providers } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";

// Mainnets (43114, 1) are included so MetaMask wallets sitting on those
// chains at login time pass ConnectKit's chain validation without a
// forced switch popup. Trading is scoped to Fuji + Arc by every hook
// and contract address.
//
// Sepolia + Arbitrum Sepolia are spoke chains for cross-chain deposits.
export const config = createConfig(
  getDefaultConfig({
    chains: [
      avalancheFuji,
      arcTestnet,
      avalanche,
      mainnet,
      sepolia,
      arbitrumSepolia,
    ],
    transports: {
      [avalancheFuji.id]: http("https://api.avax-test.network/ext/bc/C/rpc"),
      [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
      [avalanche.id]: http("https://api.avax.network/ext/bc/C/rpc"),
      [mainnet.id]: http("https://cloudflare-eth.com"),
      [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
      [arbitrumSepolia.id]: http("https://arbitrum-sepolia-rpc.publicnode.com"),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "552cc1a2e5cd90a14345caa96a055f3c",
    appName: "BUFX",
    appDescription: "Agentic Forex Stablecoin Trading",
    appUrl: "https://fx.bu.finance",
    appIcon: "https://fx.bu.finance/images/iso-logo.png",
    ssr: true,
  }),
);

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

export function clientToSigner(client: Client<Transport, Chain, Account>) {
  const { account, chain, transport } = client;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new providers.Web3Provider(transport, network);
  const signer = provider.getSigner(account.address);
  return signer;
}

export function useEthersSigner({ chainId }: { chainId?: number } = {}) {
  const { data: client } = useConnectorClient<Config>({ chainId });
  return useMemo(() => (client ? clientToSigner(client) : undefined), [client]);
}
