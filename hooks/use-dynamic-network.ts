import { useEffect, useMemo, useCallback } from "react";
import { useDynamicContext, getNetwork } from "@dynamic-labs/sdk-react-core";
import { useNetworkStore } from "@/store";

export const useNetworkManager = () => {
  const { primaryWallet } = useDynamicContext();
  const { setCurrentChainId, setLoading, setError, currentChainId } =
    useNetworkStore();

  const connector = useMemo(() => primaryWallet?.connector, [primaryWallet]);

  const updateNetwork = useCallback(async () => {
    if (!connector) {
      setCurrentChainId(undefined);
      return;
    }

    setLoading(true);
    try {
      const network = await getNetwork(connector);
      setCurrentChainId(network as number | undefined);
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to get network"
      );
      setCurrentChainId(undefined);
    } finally {
      setLoading(false);
    }
  }, [connector, setCurrentChainId, setError, setLoading]);

  useEffect(() => {
    updateNetwork();
  }, [updateNetwork]);


  return currentChainId;
};
