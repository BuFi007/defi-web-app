import { Chain } from "@/lib/types";

export const Base: Chain = {
  chainId: 8453,
  isMainnet: true,
  name: "Base",
  nativeCurrency: {
    name: "Base",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
  },
  rpcUrls: [
    `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://base.blockscout.com"],
  chainName: "Base",
  vanityName: "Base",
  networkId: 8453,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
};

export const BaseSepolia: Chain = {
  chainId: 84532,
  isMainnet: false,
  name: "Base",
  nativeCurrency: {
    name: "Base",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
  },
  rpcUrls: [
    `https://base-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://base-sepolia.blockscout.com"],
  chainName: "BaseSepolia",
  vanityName: "Base Sepolia",
  networkId: 84532,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
};

export const Avalanche: Chain = {
  chainId: 43114,
  isMainnet: true,
  name: "Avalanche",
  blockExplorerUrls: ["https://snowtrace.io/"],
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/avax.svg"],
  },
  rpcUrls: ["https://rpc.ankr.com/avalanche"],
  vanityName: "Avalanche ",
  chainName: "Avalanche",
  networkId: 43114,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/avax.svg"],
};

export const AvalancheFuji: Chain = {
  chainId: 43113,
  isMainnet: false,
  name: "Avalanche",
  blockExplorerUrls: ["https://fuji.snowtrace.io/"],
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/avax.svg"],
  },
  rpcUrls: ["https://rpc.ankr.com/avalanche_fuji"],
  vanityName: "Avalanche Fuji",
  chainName: "AvalancheFuji",
  networkId: 43113,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/avax.svg"],
};

export const Arbitrum: Chain = {
  chainId: 42161,
  isMainnet: true,
  name: "Arbitrum",
  nativeCurrency: {
    name: "Arbitrum",
    symbol: "ARB",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/arbitrum.svg"],
  },
  rpcUrls: [
    `https://arb.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://explorer.arbitrum.io/"],
  vanityName: "Arbitrum Sepolia",
  chainName: "ArbitrumSepolia",
  networkId: 42161,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/arbitrum.svg"],
};

export const ArbitrumSepolia: Chain = {
  chainId: 421614,
  isMainnet: false,
  name: "Arbitrum",
  nativeCurrency: {
    name: "Arbitrum",
    symbol: "ARB",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/arbitrum.svg"],
  },
  rpcUrls: [
    `https://arb-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://sepolia-explorer.arbitrum.io/"],
  vanityName: "Arbitrum Sepolia",
  chainName: "ArbitrumSepolia",
  networkId: 421614,
  iconUrls: ["https://app.dynamic.xyz/assets/networks/arbitrum.svg"],
};
