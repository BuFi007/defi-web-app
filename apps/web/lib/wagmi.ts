import { http, createConfig, useConnectorClient, Config } from "wagmi";
import {
  avalanche,
  avalancheFuji,
  arcTestnet,
  mainnet,
  sepolia,
  arbitrumSepolia,
} from "wagmi/chains";
import { useMemo } from "react";
import { providers } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";

// Avalanche mainnet (43114) AND Ethereum mainnet (1) are included for
// AUTH SHAPE PARITY with the Dynamic provider config
// (apps/web/context/DynamicProviders.tsx). When a chain lives in
// Dynamic's evmNetworks but is missing here, WalletConnectProvider init
// crashes (`r.bindings is not a function`) and Dynamic warns about the
// asymmetry. Trading is still scoped to Fuji + Arc by every hook and
// contract address; the two mainnet entries are read-only targets that
// only exist to satisfy the auth handshake when the user has their
// wallet on those chains at login time. Without Ethereum mainnet here,
// MetaMask's default chain trips Dynamic's networkValidationMode and
// fires a chain-switch popup; dismissing it surfaces as RPC 4100
// "method not authorized" + revoked accounts.
//
// Sepolia + Arbitrum Sepolia are spoke chains: users can deposit a stable
// issued on either of them and have the loan execute at the Fuji/Arc hub
// of their choice. They're included here so the wallet dropdown can read
// real per-chain balances (USDC, MXNB) instead of just hub balances —
// without them, `useBalance({ chainId: 11155111 })` silently no-ops.
export const config = createConfig({
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
    // Empty http() defaults route through viem's per-chain default
    // (eth.merkle.io for mainnet) which CORS-rejects from localhost and
    // floods the console. Pin to CORS-friendly public endpoints that
    // ad-blockers don't usually flag.
    [mainnet.id]: http("https://cloudflare-eth.com"),
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
    [arbitrumSepolia.id]: http("https://arbitrum-sepolia-rpc.publicnode.com"),
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
