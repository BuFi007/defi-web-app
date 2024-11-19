import {
  BaseTokens,
  AvalancheTokens,
  AvalancheFujiTokens,
  BaseSepoliaTokens,
} from "@/constants/Tokens";

export const useUsdcChain = (
  chainId: number | undefined | string,
  isMainnet?: boolean
) => {
  //   if (!chainId) return "error no chain id";
  if (chainId === 84532 && isMainnet)
    return BaseTokens.filter((token) => token.symbol === "USDC");
  if (chainId === 43113 && isMainnet)
    return AvalancheTokens.filter((token) => token.symbol === "USDC");
  if (chainId === 43113 && !isMainnet)
    return AvalancheFujiTokens.filter((token) => token.symbol === "USDC");

  if (chainId === 84532 && !isMainnet)
    return BaseSepoliaTokens.filter((token) => token.symbol === "USDC");
};
