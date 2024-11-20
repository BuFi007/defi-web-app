import { useEffect } from "react";
import { useDynamicContext, getNetwork } from "@dynamic-labs/sdk-react-core";
import { useNetworkStore } from "@/store";
import { useChainId } from "wagmi";

export const useNetworkManager = () => {
  const { primaryWallet } = useDynamicContext();
  const chainId = useChainId();
  const { setCurrentChainId, setLoading, setError, currentChainId } =
    useNetworkStore();

  useEffect(() => {
    const updateNetwork = async () => {
      if (!primaryWallet?.connector) {
        setCurrentChainId(undefined);
        return;
      }

      setLoading(true);
      try {
        const network = await getNetwork(primaryWallet.connector);
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
    };

    updateNetwork();
  }, [
    primaryWallet?.connector,
    primaryWallet?.switchNetwork,
    currentChainId,
    chainId,
  ]);
  return currentChainId;
};
