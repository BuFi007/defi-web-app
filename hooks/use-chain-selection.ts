import { useEffect } from "react";
import { useMarketStore } from "@/store";
import { getFromChains, getToChains } from "@/utils";
import { IS_MAINNET } from "@/constants/Env";
export const useChainSelection = () => {
  const { currentViewTab, setFromChain, setToChain, fromChain, toChain} = useMarketStore();
  return {
    currentViewTab,
    fromChains: getFromChains(currentViewTab, IS_MAINNET),
    toChains: getToChains(currentViewTab, IS_MAINNET),
    setFromChain,
    setToChain,
    fromChain,
    toChain
  };
};
