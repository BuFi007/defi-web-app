export const Base = {
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

export const BaseSepolia = {
  chainId: 84532,
  isMainnet: false,
  name: "Base",
  nativeCurrency: {
    name: "Base",
    symbol: "ETH",
    decimals: 18,
    iconUrls: [
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
    ],
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

export const Avalanche = {
  chainId: 43114,
  isMainnet: true,
  name: "Avalanche",
  blockExplorerUrls: ["https://snowtrace.io/"],
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
    iconUrls: ["/networks/avax.svg"],
  },
  rpcUrls: ["https://rpc.ankr.com/avalanche"],
  vanityName: "Avalanche ",
  chainName: "Avalanche",
  networkId: 43114,
  iconUrls: ["/networks/avax.svg"],
};

export const AvalancheFuji = {
  chainId: 43113,
  isMainnet: false,
  name: "Avalanche",
  blockExplorerUrls: ["https://fuji.snowtrace.io/"],
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
    iconUrls: ["/networks/avax.svg"],
  },
  // PublicNode mirror — serves CORS headers; the canonical
  // `api.avax-test.network` does not, which floods the console with
  // ~50 errors per page load. NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL
  // overrides for staging.
  rpcUrls: [
    process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ??
      "https://avalanche-fuji-c-chain-rpc.publicnode.com",
  ],
  vanityName: "Avalanche Fuji",
  chainName: "AvalancheFuji",
  networkId: 43113,
  iconUrls: ["/networks/avax.svg"],
};

export const Arbitrum = {
  chainId: 42161,
  isMainnet: true,
  name: "Arbitrum",
  nativeCurrency: {
    name: "Arbitrum",
    symbol: "ARB",
    decimals: 18,
    iconUrls: ["/networks/arbitrum.svg"],
  },
  rpcUrls: [
    `https://arb-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://explorer.arbitrum.io/"],
  vanityName: "Arbitrum",
  chainName: "Arbitrum",
  networkId: 42161,
  iconUrls: ["/networks/arbitrum.svg"],
};

export const ArbitrumSepolia = {
  chainId: 421614,
  isMainnet: false,
  name: "Arbitrum",
  nativeCurrency: {
    name: "Arbitrum",
    symbol: "ARB",
    decimals: 18,
    iconUrls: ["/networks/arbitrum.svg"],
  },
  rpcUrls: [
    `https://arb-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
  ],
  blockExplorerUrls: ["https://sepolia-explorer.arbitrum.io/"],
  vanityName: "Arbitrum Sepolia",
  chainName: "ArbitrumSepolia",
  networkId: 421614,
  iconUrls: ["/networks/arbitrum.svg"],
};

export const ZkSync = {
  chainId: 324,
  rpcUrls: ["https://mainnet.era.zksync.io"],
  isMainnet: true,
  networkId: 324,
  name: "ZkSync",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    iconUrls: [
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
    ],
  },
  blockExplorerUrls: ["https://explorer.zksync.io"],
  vanityName: "ZkSync",
  chainName: "ZkSync",
  iconUrls: [
    "https://assets.coingecko.com/coins/images/38043/standard/ZKTokenBlack.png?1718614502",
  ],
};

export const ZkSyncSepolia = {
  chainId: 300,
  name: "ZkSync Sepolia",
  rpcUrls: ["https://sepolia.era.zksync.dev"],
  isMainnet: false,
  networkId: 300,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    iconUrls: [
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
    ],
  },
  blockExplorerUrls: ["https://sepolia.explorer.zksync.io"],
  vanityName: "ZkSync Sepolia",
  chainName: "ZkSyncSepolia",
  iconUrls: [
    "https://assets.coingecko.com/coins/images/38043/standard/ZKTokenBlack.png?1718614502",
  ],
};

export const Optimism = {
  chainId: 10,
  name: "Optimism",
  rpcUrls: ["https://mainnet.optimism.io"],
  isMainnet: true,
  networkId: 10,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/optimism.svg"],
  },
  blockExplorerUrls: ["https://explorer.optimism.io"],
  vanityName: "Optimism",
  chainName: "Optimism",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/optimism.svg"],
};

export const SepoliaOptimism = {
  chainId: 11155420,
  name: "Sepolia Optimism",
  rpcUrls: ["https://sepolia.optimism.io"],
  isMainnet: false,
  networkId: 11155420,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/optimism.svg"],
  },
  blockExplorerUrls: ["https://sepolia-optimism.etherscan.io/"],
  vanityName: "Optimism Sepolia",
  chainName: "OptimismSepolia",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/optimism.svg"],
};

export const Bsc = {
  chainId: 56,
  name: "BSC",
  rpcUrls: ["https://bsc-dataseed.binance.org"],
  isMainnet: true,
  networkId: 56,
  nativeCurrency: {
    name: "Binance Smart Chain",
    symbol: "BNB",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/bnb.svg"],
  },
  blockExplorerUrls: ["https://bscscan.com"],
  vanityName: "BSC",
  chainName: "BSC",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/bnb.svg"],
};

export const BscTestnet = {
  chainId: 97,
  name: "BSC Testnet",
  rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
  isMainnet: false,
  networkId: 97,
  nativeCurrency: {
    name: "Binance Smart Chain",
    symbol: "BNB",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/bnb.svg"],
  },
  blockExplorerUrls: ["https://bscscan.com"],
  vanityName: "BSC Testnet",
  chainName: "BscTestnet",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/bnb.svg"],
};

export const ModeTestnet = {
  chainId: 919,
  name: "Mode Testnet",
  rpcUrls: ["https://sepolia.mode.network"],
  isMainnet: false,
  networkId: 919,
  nativeCurrency: {
    name: "Mode",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["https://app.dynamic.xyz/assets/networks/mode.svg"],
  },
  blockExplorerUrls: ["https://sepolia.explorer.mode.network"],
  vanityName: "Mode Testnet",
  chainName: "ModeTestnet",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/mode.svg"],
};

export const ArcTestnet = {
  chainId: 5042002,
  name: "Arc Testnet",
  rpcUrls: ["https://rpc.testnet.arc.network"],
  isMainnet: false,
  networkId: 5042002,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
    iconUrls: ["/networks/arc.svg"],
  },
  blockExplorerUrls: ["https://testnet.arcscan.app"],
  vanityName: "Arc Testnet",
  chainName: "ArcTestnet",
  iconUrls: ["/networks/arc.svg"],
};

// Ethereum mainnet — AUTH-HANDSHAKE ONLY. Same pattern as Avalanche
// mainnet: not a trading target, just allow-listed so that Dynamic's
// networkValidationMode: "always" doesn't reject a wallet that's
// sitting on chain 1 at login. MetaMask's default chain is Ethereum
// mainnet, so without this entry Dynamic forces a chain switch
// (wallet_switchEthereumChain / wallet_addEthereumChain) which can
// surface as RPC 4100 "method not authorized" when the user dismisses
// the popup. Trading hooks still gate on Fuji/Arc only.
export const Ethereum = {
  chainId: 1,
  isMainnet: true,
  name: "Ethereum",
  blockExplorerUrls: ["https://etherscan.io/"],
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["/networks/eth.svg"],
  },
  rpcUrls: ["https://eth.llamarpc.com"],
  vanityName: "Ethereum",
  chainName: "Ethereum",
  networkId: 1,
  iconUrls: ["/networks/eth.svg"],
};

// Ethereum Sepolia — spoke chain. Users deposit USDC/MXNB here, the
// FxSpoke contract bridges via CCTP V2 to the hub of their choice.
export const Sepolia = {
  chainId: 11155111,
  isMainnet: false,
  name: "Ethereum",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    iconUrls: ["/networks/eth.svg"],
  },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io/"],
  vanityName: "Ethereum Sepolia",
  chainName: "Sepolia",
  networkId: 11155111,
  iconUrls: ["/networks/eth.svg"],
};
