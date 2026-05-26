import { useEffect, useCallback } from "react";
import { useChainId } from "wagmi";
import { useNetworkStore } from "@/store";
import { ChainList } from "@/lib/types";

export const useNetworkManager = (): ChainList => {
  const chainId = useChainId();
  const { setCurrentChainId, setLoading, setError, currentChainId } =
    useNetworkStore();

  const updateNetwork = useCallback(() => {
    if (!chainId) {
      setCurrentChainId(undefined);
      return;
    }

    setLoading(true);
    try {
      setCurrentChainId(chainId as number | undefined);
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to get network"
      );
      setCurrentChainId(undefined);
    } finally {
      setLoading(false);
    }
  }, [chainId, setCurrentChainId, setError, setLoading]);

  useEffect(() => {
    updateNetwork();
  }, [updateNetwork]);

  return currentChainId as ChainList;
};
