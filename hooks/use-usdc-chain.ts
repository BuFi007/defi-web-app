import {
  BaseTokens,
  AvalancheTokens,
  AvalancheFujiTokens,
  BaseSepoliaTokens,
} from "@/constants/Tokens";
import { IS_MAINNET as isMainnet } from "@/constants/Env";

export const useUsdcChain = (
  chainId: number | undefined | string,
) => {
  if (chainId === 84532 && isMainnet)
    return BaseTokens.filter((token) => token.symbol === "USDC");
  if (chainId === 43113 && isMainnet)
    return AvalancheTokens.filter((token) => token.symbol === "USDC");
  if (chainId === 43113 && !isMainnet)
    return AvalancheFujiTokens.filter((token) => token.symbol === "USDC");
  if (chainId === 84532 && !isMainnet)
    return BaseSepoliaTokens.filter((token) => token.symbol === "USDC");
};
