import {
  AvalancheTokens,
  BaseSepoliaTokens,
  AvalancheFujiTokens,
  BaseTokens,
} from "@/constants/Tokens";
import {
  Avalanche,
  Base,
  BaseSepolia,
  AvalancheFuji,
} from "@/constants/Chains";

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain",
  isMainnet?: boolean
) => {
  if (type === "tokens" && !isMainnet) {
    if (chainId === 43113) return AvalancheFujiTokens;
    if (chainId === 84532) return BaseSepoliaTokens;
  }
  if (type === "tokens" && isMainnet) {
    if (chainId === 8453) return BaseTokens;
    if (chainId === 43114) return AvalancheTokens;
  }
  if (type === "chain" && !isMainnet) {
    if (chainId === 43113) return AvalancheFuji;
    if (chainId === 84532) return BaseSepolia;
  }
  if (type === "chain" && isMainnet) {
    if (chainId === 8453) return Base;
    if (chainId === 43114) return Avalanche;
  }
};
