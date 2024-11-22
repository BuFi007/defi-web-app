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


// use memo de variable de retorno abstraida ex. connector


// use callback para envolver la logica de la funcion, y obtener la variable de retorno

// useEffect para actualizar el estado de la variable de retorno envuelto en el callback y use
// memo solo cuando se detecta el cambio del memo/callback/useEffect inicial que viene de la variable curremtChainId en use-dynamic-network
