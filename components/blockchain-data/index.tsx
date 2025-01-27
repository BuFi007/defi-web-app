import { useReadContract, useAccount } from "wagmi";
import { hubAbi } from "@/constants/ABI";
import { ModeTestnetTokens } from "@/constants/Tokens";
import { HUB_AVALANCHE_CONTRACT_ADDRESS } from "@/constants/Contracts";
import { useBlockchain } from "@/context/BlockchainContext";
import { useState } from "react";

export const useMarketData = () => {
  const { address: userAddress } = useAccount();
  const [loading, setLoading] = useState(false);
  const { positions, setPositions } = useBlockchain();

  const assetsToCheck = [
    ModeTestnetTokens[1].address as `0x${string}`,
    ModeTestnetTokens[2].address as `0x${string}`,
  ];

  // Obtener información del activo usando useReadContract
  const { data: assetInfo1 } = useReadContract({
    address: HUB_AVALANCHE_CONTRACT_ADDRESS,
    abi: hubAbi,
    functionName: "getAssetInfo",
    args: [assetsToCheck[0]],
  });

  const { data: assetInfo2 } = useReadContract({
    address: HUB_AVALANCHE_CONTRACT_ADDRESS,
    abi: hubAbi,
    functionName: "getAssetInfo",
    args: [assetsToCheck[1]],
  });

  // Obtener balances del usuario usando useReadContract
  const { data: userBalance1 } = useReadContract({
    address: HUB_AVALANCHE_CONTRACT_ADDRESS,
    abi: hubAbi,
    functionName: "getUserBalance",
    args: [userAddress as `0x${string}`, assetsToCheck[0]],
  });

  const { data: userBalance2 } = useReadContract({
    address: HUB_AVALANCHE_CONTRACT_ADDRESS,
    abi: hubAbi,
    functionName: "getUserBalance",
    args: [userAddress as `0x${string}`, assetsToCheck[1]],
  });

  // Función para actualizar las posiciones con la información del activo
  const updateAssetInfo = (assetInfo: any, asset: `0x${string}`) => {
    if (assetInfo) {
      console.log(assetInfo, "assetInfo");
      setPositions([
        ...positions,
        {
          asset: asset,
          collateralizationRatioDeposit:
            assetInfo.collateralizationRatioDeposit,
          collateralizationRatioBorrow: assetInfo.collateralizationRatioBorrow,
        },
      ]);
    }
  };

  // Función para actualizar las posiciones con los balances del usuario
  const updateUserPositions = (userBalance: any, asset: `0x${string}`) => {
    if (
      userBalance &&
      (userBalance.deposited > 0 || userBalance.borrowed > 0)
    ) {
      const existingPosition = positions.find(
        (position) => position.asset === asset
      );

      if (existingPosition) {
        // Si la posición existe, actualizar sumando solo los deposits
        setPositions(
          positions.map((position) =>
            position.asset === asset
              ? {
                  ...position,
                  deposited: (
                    BigInt(position.deposited || 0) +
                    BigInt(userBalance.deposited)
                  ).toString(),
                  borrowed: userBalance.borrowed.toString(), // Reemplazar en lugar de sumar
                }
              : position
          )
        );
      } else {
        // Si la posición no existe, crear una nueva
        setPositions([
          ...positions,
          {
            asset: asset,
            deposited: userBalance.deposited.toString(),
            borrowed: userBalance.borrowed.toString(),
          },
        ]);
      }
    }
  };

  const fetchMarketData = () => {
    setLoading(true);

    if (assetInfo1) updateAssetInfo(assetInfo1, assetsToCheck[0]);
    if (assetInfo2) updateAssetInfo(assetInfo2, assetsToCheck[1]);

    if (userBalance1) updateUserPositions(userBalance1, assetsToCheck[0]);
    if (userBalance2) updateUserPositions(userBalance2, assetsToCheck[1]);
    setLoading(false);
  };

  return { fetchMarketData, loading };
};
