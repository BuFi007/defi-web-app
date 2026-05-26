"use client";
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useMemo,
} from "react";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { hubAbi } from "@/constants/ABI";
import { AvalancheFujiTokens, ModeTestnetTokens } from "@/constants/Tokens";
import { HUB_AVALANCHE_CONTRACT_ADDRESS } from "@/constants/Contracts";
import { useNetworkManager } from "@/hooks/use-network";
import { getAllChains } from "@/utils";
import { AvalancheFuji } from "@/constants/Chains";

interface BlockchainContextProps {
  address: Address | string | undefined;
  isConnected?: boolean;
  positions: any[];
  moneyMarketData: any[];
  refreshData: () => Promise<void>;
  isLoadingPositions: boolean;
}

const BlockchainContext = createContext<BlockchainContextProps | undefined>(
  undefined
);

export const useBlockchain = () => {
  const context = useContext(BlockchainContext);
  if (!context) {
    throw new Error(
      "useBlockchain debe ser usado dentro de un BlockchainProvider"
    );
  }
  return context;
};

export const BlockchainProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string | null | undefined>();
  const [positions, setPositions] = useState<any[]>([]);
  const [moneyMarketData, setMoneyMarketData] = useState<any[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const { address: addressFromWagmi, isConnected: isConnectedWagmi } =
    useAccount();
  const [isConnected, setIsConnected] = useState(false);
  const provider = new ethers.providers.JsonRpcProvider(
    AvalancheFuji.rpcUrls[0]
  );

  const contract = useMemo(() => {
    if (provider) {
      return new ethers.Contract(
        HUB_AVALANCHE_CONTRACT_ADDRESS,
        hubAbi,
        provider
      );
    }
    return null;
  }, [provider]);

  const assetsToCheck = useMemo(
    () => [AvalancheFujiTokens[1]?.address, AvalancheFujiTokens[2]?.address],
    []
  );

  const fetchMoneyMarketData = async () => {
    if (!contract || !isConnected) return;

    try {
      const [assetInfo1, assetInfo2] = await Promise.all([
        contract.getAssetInfo(assetsToCheck[0]),
        contract.getAssetInfo(assetsToCheck[1]),
      ]);
      console.log(assetInfo1, "assetInfo1");

      const newMoneyMarketData = [];

      if (assetInfo1) {
        newMoneyMarketData.push({
          asset: assetsToCheck[0],
          ...assetInfo1,
        });
      }

      if (assetInfo2) {
        newMoneyMarketData.push({
          asset: assetsToCheck[1],
          ...assetInfo2,
        });
      }

      setMoneyMarketData(newMoneyMarketData);
    } catch (error) {
      console.error("Error fetching money market data:", error);
    }
  };

  const fetchPositions = async () => {
    if (!contract || !isConnected || !address) return;
    setIsLoadingPositions(true);
    try {
      const [userBalance1, userBalance2] = await Promise.all([
        contract.getUserBalance(address, assetsToCheck[0]),
        contract.getUserBalance(address, assetsToCheck[1]),
      ]);

      const newPositions = [];

      if (
        userBalance1 &&
        (userBalance1.deposited > 0 || userBalance1.borrowed > 0)
      ) {
        newPositions.push({
          asset: assetsToCheck[0],
          deposited: userBalance1.deposited.toString(),
          borrowed: userBalance1.borrowed.toString(),
        });
      }

      if (
        userBalance2 &&
        (userBalance2.deposited > 0 || userBalance2.borrowed > 0)
      ) {
        newPositions.push({
          asset: assetsToCheck[1],
          deposited: userBalance2.deposited.toString(),
          borrowed: userBalance2.borrowed.toString(),
        });
      }

      setPositions(newPositions);
      setIsLoadingPositions(false);
    } catch (error) {
      setIsLoadingPositions(false);
      console.error("Error fetching positions:", error);
    }
  };

  const refreshData = async () => {
    await Promise.all([fetchMoneyMarketData(), fetchPositions()]);
  };

  useEffect(() => {
    setAddress(addressFromWagmi || null);
    setIsConnected(isConnectedWagmi);
  }, [isConnectedWagmi, addressFromWagmi]);

  useEffect(() => {
    if (isConnected && address) {
      refreshData();
    }
  }, [isConnected, address]);

  return (
    <BlockchainContext.Provider
      value={{
        address: address || "",
        isConnected,
        positions,
        moneyMarketData,
        refreshData,
        isLoadingPositions,
      }}
    >
      {children}
    </BlockchainContext.Provider>
  );
};
