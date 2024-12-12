import type { Token } from "@/lib/types";
import { Hex } from "viem";

export const NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Hex;
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////
export const AvalancheFujiTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 43113,
    decimals: 18,
    name: "Avax",
    payable: false,
    symbol: "AVA",
    image:
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
  },
  {
    address: "0x5425890298aed601595a70AB815c96711a31Bc65" as Hex,
    chainId: 43113,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////
export const BaseSepoliaTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 84532,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image:
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
  },
  {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex,
    chainId: 84532,
    decimals: 6,
    name: "USDC",
    symbol: "USDC",
    payable: true,
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////

export const BaseTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 84532,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image:
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
  },
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex,
    chainId: 8453,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];
////////////////////////////// TOKEN ORDER IS IMPORTANT //////////////////////////////

export const AvalancheTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 43114,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image:
      "https://dynamic-assets.coinbase.com/dbb4b4983bde81309ddab83eb598358eb44375b930b94687ebe38bc22e52c3b2125258ffb8477a5ef22e33d6bd72e32a506c391caa13af64c00e46613c3e5806/asset_icons/4113b082d21cc5fab17fc8f2d19fb996165bcce635e6900f7fc2d57c4ef33ae9.png",
  },
  {
    address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" as Hex,
    chainId: 43114,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const ArbitrumTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 42161,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image: "https://app.dynamic.xyz/assets/networks/arbitrum.svg",
  },
  {
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Hex,
    chainId: 42161,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const ArbitrumSepoliaTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 421614,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image: "https://app.dynamic.xyz/assets/networks/arbitrum.svg",
  },
  {
    address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Hex,
    chainId: 421614,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const BscTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 56,
    decimals: 18,
    name: "Binance Smart Chain",
    payable: false,
    symbol: "BNB",
    image: "https://app.dynamic.xyz/assets/networks/bnb.svg",
  },
  {
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" as Hex,
    chainId: 56,
    decimals: 18,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const OptimismTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 10,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image: "https://app.dynamic.xyz/assets/networks/optimism.svg",
  },
  {
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Hex,
    chainId: 10,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const ZkSyncTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 324,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image: "https://app.dynamic.xyz/assets/networks/zksync.svg",
  },
  {
    address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4" as Hex,
    chainId: 324,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const ZkSyncSepoliaTokens: Token[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    chainId: 324,
    decimals: 18,
    name: "Ethereum",
    payable: false,
    symbol: "ETH",
    image: "https://app.dynamic.xyz/assets/networks/zksync.svg",
  },
  {
    address: "0xAe045DE5638162fa134807Cb558E15A3F5A7F853" as Hex,
    chainId: 324,
    decimals: 6,
    name: "USDC",
    payable: true,
    symbol: "USDC",
    image:
      "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  },
];

export const allTokens = [
  ...AvalancheFujiTokens,
  ...BaseSepoliaTokens,
  ...BaseTokens,
  ...AvalancheTokens,
  ...ArbitrumTokens,
  ...ArbitrumSepoliaTokens,
  ...BscTokens,
  ...OptimismTokens,
  ...ZkSyncTokens,
  ...ZkSyncSepoliaTokens,
];
