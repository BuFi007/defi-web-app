"use client";

import { parseUnits, encodeFunctionData, erc20Abi } from "viem";
import { spokeAbi } from "@/constants/ABI";
import type { Address, Hex } from "viem";
import * as chains from "@/constants/Chains";
import type { TransferWrapperProps } from "@/lib/types";
import { useReadContract, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useUsdcChain } from "@/hooks/use-usdc-chain";

const TransferWrapper: React.FC<TransferWrapperProps> = ({
  amount,
  onSuccess,
  onError,
  functionName,
  buttonText,
  argsExtra = [],
}) => {
  const { writeContract, error, data, isIdle, isError } = useWriteContract();
  const chain = Object.values(chains).find((c) => c.name === "Base Sepolia");
  
  if (!chain) {
    console.error("Chain 'Base Sepolia' not found in chains configuration.");
    return null;
  }

  let costForReturnDelivery: bigint | undefined;

  const chainId = chain.chainId;

  // Retrieve spoke contract address
  // const spokeContract = currencyAddresses[chainId]?.USDC?.spokeContract;
  const spokeContract = "0xA8f6Db88D79bcA5F1990C93b6a6eA5866722d198"; /// todo remove this
  if (!spokeContract) {
    console.error(`Spoke contract address for chain ID ${chainId} not found.`);
    return null;
  }

  const assetAddress = useUsdcChain()?.address;
  const assetAmount = parseUnits(amount || "0", 6);

  // Ensure that the costForReturnDelivery is calculated properly
  if (argsExtra.length > 0 && argsExtra[0]) {
    costForReturnDelivery = BigInt(
      parseUnits(argsExtra[0].toString(), 18).toString()
    );
  }

  const {
    data: msgValueAmount,
    isLoading,
    isError: errorAmount,
    error: errorA,
  } = useReadContract({
    abi: spokeAbi,
    functionName: "getDeliveryCostRoundtrip",
    args: [costForReturnDelivery || 1n, true],
  });

  console.log({ isLoading, msgValueAmount, errorAmount, errorA });

  // Encode function data for the contract call
  const encodedData = encodeFunctionData({
    abi: spokeAbi,
    functionName: functionName,
    args: [assetAddress as Hex, assetAmount, costForReturnDelivery || 0n],
  });

  return (
    <div className="flex w-full">
      {/* <Transaction
        chainId={chainId}
        calls={calls}
        // onError={onError}
        onSuccess={(response: TransactionResponse) => {
          const transactionHash =
            response?.transactionReceipts?.[0]?.transactionHash;
          if (transactionHash) {
            onSuccess(transactionHash);
          }
        }}
      >
        <TransactionButton
          text={buttonText}
          className="bg-clr-blue text-black dark:text-black hover:bg-blue-600/80 border-2 border-border dark:border-darkBorder shadow-light dark:shadow-dark hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none dark:hover:shadow-none"
        />
        <TransactionStatus>
          <TransactionStatusLabel />
          <TransactionStatusAction />
        </TransactionStatus>
      </Transaction> */}

      <Button
        variant="brutalism"
        className="w-full p-4 justify-center bg-clr-blue text-black dark:text-black hover:bg-blue-600/80 border-2 border-border dark:border-darkBorder shadow-light dark:shadow-dark hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none dark:hover:shadow-none"
        onClick={() =>
          writeContract({
            address: "0xA8f6Db88D79bcA5F1990C93b6a6eA5866722d198",
            abi: spokeAbi,
            functionName: "depositCollateral",
            args: [
              assetAddress as Hex,
              assetAmount,
              costForReturnDelivery || 0n,
            ],
            value: 1000000n,
          })
        }
      >
        Transfer
      </Button>
    </div>
  );
};

export default TransferWrapper;
