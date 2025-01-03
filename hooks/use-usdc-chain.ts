import {
  BaseTokens,
  AvalancheTokens,
  AvalancheFujiTokens,
  BaseSepoliaTokens,
} from "@/constants/Tokens";
import { IS_MAINNET as isMainnet } from "@/constants/Env";
import { useEffect, useMemo, useCallback, useState } from "react";
import { useNetworkManager } from "./use-dynamic-network";
import * as Chains from "@/constants/Chains";
import { Token } from "@/lib/types";
import { useChainId } from "wagmi";

export const useUsdcChain = () => {
  const currentChainId = useNetworkManager();
  const [usdcToken, setUsdcToken] = useState<Token | null>(null);
  const chainId = useMemo(
    () => (currentChainId === undefined ? undefined : Number(currentChainId)),
    [currentChainId]
  );

  const updateUsdcToken = useCallback(async () => {
    if (chainId === undefined) {
      setUsdcToken(null);
    }
    try {
      if (chainId === Chains.Avalanche.chainId && isMainnet) {
        setUsdcToken(AvalancheTokens[1]);
      } else if (chainId === Chains.AvalancheFuji.chainId && !isMainnet) {
        setUsdcToken(AvalancheFujiTokens[1]);
      } else if (chainId === Chains.Base.chainId && isMainnet) {
        setUsdcToken(BaseTokens[1]);
      } else if (chainId === Chains.BaseSepolia.chainId && !isMainnet) {
        setUsdcToken(BaseSepoliaTokens[1]);
      }
    } catch (error) {
      setUsdcToken(null);
    }
  }, [chainId, setUsdcToken]);

  useEffect(() => {
    updateUsdcToken();
  }, [updateUsdcToken]);

  return usdcToken;
};


// use memo de variable de retorno abstraida ex. connector


// use callback para envolver la logica de la funcion, y obtener la variable de retorno

// useEffect para actualizar el estado de la variable de retorno envuelto en el callback y use
// memo solo cuando se detecta el cambio del memo/callback/useEffect inicial que viene de la variable curremtChainId en use-dynamic-network
