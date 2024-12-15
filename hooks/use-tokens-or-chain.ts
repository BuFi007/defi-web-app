import {
  AvalancheTokens,
  BaseSepoliaTokens,
  AvalancheFujiTokens,
  BaseTokens,
  ArbitrumSepoliaTokens,
  ArbitrumTokens,
  OptimismTokens,
  ZkSyncSepoliaTokens,
  BscTokens,
  ZkSyncTokens,
  SepoliaOptimismTokens,
} from "@/constants/Tokens";
import {
  Avalanche,
  Base,
  BaseSepolia,
  AvalancheFuji,
  Arbitrum,
  ArbitrumSepolia,
  ZkSyncSepolia,
  Bsc,
  ZkSync,
  Optimism,
  SepoliaOptimism,
} from "@/constants/Chains";
import { IS_MAINNET as isMainnet } from "@/constants/Env";

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain"
) => {
  if (type === "tokens" && !isMainnet) {
    if (chainId === 8453) return BaseTokens;
    if (chainId === 43114) return AvalancheTokens;
    if (chainId === 42161) return ArbitrumTokens;
    if (chainId === 56) return BscTokens;
    if (chainId === 10) return OptimismTokens;
    if (chainId === 361) return ZkSyncTokens;
    if (chainId === 43113) return AvalancheFujiTokens;
    if (chainId === 84532) return BaseSepoliaTokens;
    if (chainId === 421614) return ArbitrumSepoliaTokens;
    if (chainId === 10) return OptimismTokens;
    if (chainId === 11155420) return SepoliaOptimismTokens;
    if (chainId === 11155111) return ZkSyncSepoliaTokens;
    if (chainId === 59144) return BscTokens;
    if (chainId === 42161) return ArbitrumTokens;
    if (chainId === 361) return ZkSyncTokens;
  }
  if (type === "tokens" && isMainnet) {
    if (chainId === 8453) return BaseTokens;
    if (chainId === 43114) return AvalancheTokens;
    if (chainId === 42161) return ArbitrumTokens;
    if (chainId === 56) return BscTokens;
    if (chainId === 10) return OptimismTokens;
    if (chainId === 11155420) return SepoliaOptimismTokens;
    if (chainId === 361) return ZkSyncTokens;
    if (chainId === 43113) return AvalancheFujiTokens;
    if (chainId === 84532) return BaseSepoliaTokens;
    if (chainId === 421614) return ArbitrumSepoliaTokens;
    if (chainId === 10) return OptimismTokens;
    if (chainId === 11155111) return ZkSyncSepoliaTokens;
    if (chainId === 59144) return BscTokens;
    if (chainId === 42161) return ArbitrumTokens;
    if (chainId === 361) return ZkSyncTokens;
  }
  if (type === "chain" && !isMainnet) {
    if (chainId === 43113) return AvalancheFuji;
    if (chainId === 84532) return BaseSepolia;
    if (chainId === 421614) return ArbitrumSepolia;
    if (chainId === 11155111) return ZkSyncSepolia;
    if (chainId === 59144) return Bsc;
    if (chainId === 11155420) return SepoliaOptimism;
    if (chainId === 42161) return Arbitrum;
    if (chainId === 361) return ZkSync;
    if (chainId === 8453) return Base;
    if (chainId === 43114) return Avalanche;
    if (chainId === 42161) return Arbitrum;
    if (chainId === 56) return Bsc;
    if (chainId === 10) return Optimism;
    if (chainId === 361) return ZkSync;
  }
  if (type === "chain" && isMainnet) {
    if (chainId === 43113) return AvalancheFuji;
    if (chainId === 84532) return BaseSepolia;
    if (chainId === 421614) return ArbitrumSepolia;
    if (chainId === 11155111) return ZkSyncSepolia;
    if (chainId === 59144) return Bsc;
    if (chainId === 11155420) return SepoliaOptimism;
    if (chainId === 42161) return Arbitrum;
    if (chainId === 361) return ZkSync;
    if (chainId === 8453) return Base;
    if (chainId === 43114) return Avalanche;
    if (chainId === 42161) return Arbitrum;
    if (chainId === 56) return Bsc;
    if (chainId === 10) return Optimism;
    if (chainId === 361) return ZkSync;
  }
};
