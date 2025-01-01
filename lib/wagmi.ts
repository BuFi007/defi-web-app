import { http, createConfig, useConnectorClient, Config } from "wagmi";
import {
  avalancheFuji,
  baseSepolia,
  avalanche,
  base,
  bsc,
  bscTestnet,
} from "wagmi/chains";
import { useMemo } from "react";
import { providers } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";

export const config = createConfig({
  chains: [avalancheFuji, baseSepolia, avalanche, base, bsc, bscTestnet],
  transports: {
    [base.id]: http(),
    [avalanche.id]: http(),
    [avalancheFuji.id]: http(),
    [baseSepolia.id]: http(),
    [bsc.id]: http(),
    [bscTestnet.id]: http(),
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

export function useEthersSigner({ chainId }: { chainId?: number } = {}) {
  const { data: client } = useConnectorClient<Config>({ chainId });
  return useMemo(() => (client ? clientToSigner(client) : undefined), [client]);
}
