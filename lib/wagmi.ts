import { http, createConfig, useConnectorClient, Config } from "wagmi";
import {
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  avalanche,
  base,
  arbitrum,
  arbitrumSepolia,
} from "wagmi/chains";
import { useMemo } from "react";
import { providers } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";

export const config = createConfig({
  chains: [
    avalancheFuji,
    baseSepolia,
    arbitrumSepolia,
    avalanche,
    base,
    arbitrum,
  ],
  transports: {
    [base.id]: http(),
    [arbitrum.id]: http(),
    [avalanche.id]: http(),
    [avalancheFuji.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
});

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

/** Hook to convert a Viem Client to an ethers.js Signer. */
export function useEthersSigner({ chainId }: { chainId?: number } = {}) {
  const { data: client } = useConnectorClient<Config>({ chainId });
  return useMemo(() => (client ? clientToSigner(client) : undefined), [client]);
}
