import {
  AvalancheTokens,
  BaseSepoliaTokens,
  AvalancheFujiTokens,
  BaseTokens,
  ArbitrumSepoliaTokens,
  ArbitrumTokens,
} from "@/constants/Tokens";
import {
  Avalanche,
  Base,
  BaseSepolia,
  AvalancheFuji,
  Arbitrum,
  ArbitrumSepolia,
} from "@/constants/Chains";
import { IS_MAINNET as isMainnet } from "@/constants/Env";

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain"
) => {
  if (type === "tokens" && !isMainnet) {
    if (chainId === 43113) return AvalancheFujiTokens;
    if (chainId === 84532) return BaseSepoliaTokens;
    if (chainId === 421614) return ArbitrumSepoliaTokens;
  }
  if (type === "tokens" && isMainnet) {
    if (chainId === 8453) return BaseTokens;
    if (chainId === 43114) return AvalancheTokens;
    if (chainId === 42161) return ArbitrumTokens;
  }
  if (type === "chain" && !isMainnet) {
    if (chainId === 43113) return AvalancheFuji;
    if (chainId === 84532) return BaseSepolia;
    if (chainId === 421614) return ArbitrumSepolia;
  }
  if (type === "chain" && isMainnet) {
    if (chainId === 8453) return Base;
    if (chainId === 43114) return Avalanche;
    if (chainId === 42161) return Arbitrum;
  }
};
