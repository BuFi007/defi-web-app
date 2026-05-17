import { http, createConfig, useConnectorClient, Config } from "wagmi";
import { avalancheFuji, arcTestnet } from "wagmi/chains";
import { useMemo } from "react";
import { providers } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";

export const config = createConfig({
  chains: [avalancheFuji, arcTestnet],
  transports: {
    [avalancheFuji.id]: http(),
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
  // Required for Next.js App Router + cacheComponents. Without it, wagmi
  // hooks called during the server prerender pass throw
  // `useConfig must be used within WagmiProvider` because the client
  // provider's context isn't established yet.
  ssr: true,
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
