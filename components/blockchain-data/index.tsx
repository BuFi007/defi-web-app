import { ethers } from "ethers";
import { hubAbi } from "@/constants/ABI";
import { ModeTestnetTokens } from "@/constants/Tokens";
import { HUB_AVALANCHE_CONTRACT_ADDRESS } from "@/constants/Contracts";
import { useBlockchain } from "@/context/BlockchainContext";
import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

// export const useMarketData = () => {
//   const { positions,  moneyMarketData,  } =
//     useBlockchain();
//   const { address: userAddress, isConnected } = useAccount();

//   // Add polling interval constant
//   const POLLING_INTERVAL = 15000; // 15 seconds

//   // Initialize provider and contract

//   const provider = new ethers.providers.JsonRpcProvider(
//     "https://sepolia.mode.network"
//   );

//   const contract = useMemo(() => {
//     if (provider) {
//       return new ethers.Contract(
//         HUB_AVALANCHE_CONTRACT_ADDRESS,
//         hubAbi,
//         provider
//       );
//     }
//     return null;
//   }, [provider]);

//   const assetsToCheck = useMemo(
//     () => [ModeTestnetTokens[1].address, ModeTestnetTokens[2].address],
//     [ModeTestnetTokens]
//   );

//   // Modify data fetching effect to include interval and proper dependencies
//   useEffect(() => {
//     const fetchData = async () => {
//       if (!contract || !isConnected || !userAddress) return;
//       if (positions.length > 0 && moneyMarketData.length > 0) return;
//       try {
//         // Fetch asset info
//         const [assetInfo1, assetInfo2] = await Promise.all([
//           contract.getAssetInfo(assetsToCheck[0]),
//           contract.getAssetInfo(assetsToCheck[1]),
//         ]);

//         // Fetch user balances
//         const [userBalance1, userBalance2] = await Promise.all([
//           contract.getUserBalance(userAddress, assetsToCheck[0]),
//           contract.getUserBalance(userAddress, assetsToCheck[1]),
//         ]);

//         // Update money market data
//         const newMoneyMarketData = [];

//         if (assetInfo1) {
//           newMoneyMarketData.push({
//             asset: assetsToCheck[0],
//             ...assetInfo1,
//           });
//         }

//         if (assetInfo2) {
//           newMoneyMarketData.push({
//             asset: assetsToCheck[1],

//             ...assetInfo2,
//           });
//         }

//         setMoneyMarketData(newMoneyMarketData);

//         // Update positions
//         const newPositions = [];

//         if (
//           userBalance1 &&
//           (userBalance1.deposited > 0 || userBalance1.borrowed > 0)
//         ) {
//           newPositions.push({
//             asset: assetsToCheck[0],
//             deposited: userBalance1.deposited.toString(),
//             borrowed: userBalance1.borrowed.toString(),
//           });
//         }

//         if (
//           userBalance2 &&
//           (userBalance2.deposited > 0 || userBalance2.borrowed > 0)
//         ) {
//           newPositions.push({
//             asset: assetsToCheck[1],
//             deposited: userBalance2.deposited.toString(),
//             borrowed: userBalance2.borrowed.toString(),
//           });
//         }

//         setPositions(newPositions);
//       } catch (error) {
//         console.error("Error fetching data:", error);
//       }
//     };

//     // Initial fetch
//     fetchData();

//     // Set up polling interval
//     // const interval = setInterval(fetchData, POLLING_INTERVAL);

//     // return () => clearInterval(interval);
//   }, [contract, userAddress]);

//   return { moneyMarketData, positions };
// };
