"use client";
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";
import { Address } from "viem";
import { useAccount } from "wagmi";

interface BlockchainContextProps {
  address: Address | string | undefined;
  isConnected?: boolean;
  positions: any[];
  setPositions: (positions: any[]) => void;
  moneyMarketData: any[];
  setMoneyMarketData: (moneyMarketData: any[]) => void;
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
  const { address: addressFromWagmi, isConnected: isConnectedWagmi } =
    useAccount();

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    setAddress(addressFromWagmi || null);
    setIsConnected(isConnectedWagmi);
  }, [isConnectedWagmi, addressFromWagmi]);

  return (
    <BlockchainContext.Provider
      value={{
        address: address || "",
        isConnected,
        positions,
        setPositions,
        moneyMarketData,
        setMoneyMarketData,
      }}
    >
      {children}
    </BlockchainContext.Provider>
  );
};
