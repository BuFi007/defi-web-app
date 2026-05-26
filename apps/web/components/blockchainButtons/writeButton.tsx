import React, { useState } from "react";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { WriteButtonProps } from "@/lib/types";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { hubAbi } from "@/constants/ABI";
import { erc20Abi } from "viem";
import { HUB_AVALANCHE_CONTRACT_ADDRESS } from "@/constants/Contracts";
import { useBlockchain } from "@/context/BlockchainContext";
interface ActionPayloadN {
  action: number;
  sender: string;
  assetAddress: `0x${string}`;
  assetAmount: bigint;
}

const WriteButton = ({
  label,
  contractAddress,
  abi = hubAbi,
  functionName,
  isNative,
  nativeAmount,
  args,
  tokenAddress,
  amount,
}: WriteButtonProps) => {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { refreshData } = useBlockchain();
  const handleTransaction = async () => {
    if (!address) {
      toast({
        title: "Error",
        description: "Please connect your wallet.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsPending(true);

      if (args.action === 0 || args.action === 3) {
        const approveTxHash = await writeContractAsync({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [
            HUB_AVALANCHE_CONTRACT_ADDRESS as `0x${string}`,
            args.assetAmount,
          ],
        });

        toast({
          title: "Approve transaction sent",
          description: `Transaction hash: ${approveTxHash}`,
        });

        await publicClient!.waitForTransactionReceipt({ hash: approveTxHash });
      }
      await refreshData();
      const payload: ActionPayloadN = {
        action: args.action,
        sender: address,
        assetAddress: tokenAddress as `0x${string}`,
        assetAmount: args.assetAmount,
      };

      const txHash = await writeContractAsync({
        address: HUB_AVALANCHE_CONTRACT_ADDRESS,
        abi: abi,
        functionName: "localCompleteAction",
        args: [payload] as const,
      });

      await publicClient!.waitForTransactionReceipt({ hash: txHash });

      await refreshData();

      toast({
        title: "Transaction sent successfully",
        description: `Transaction hash: ${txHash}`,
      });
    } catch (error: any) {
      console.error("Transaction error:", error);
      let errorMessage = "Transaction failed. Please try again.";
      if (error.message) {
        errorMessage = error.message;
      } else if (error.data?.message) {
        errorMessage = error.data.message;
      }
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      variant={"brutalism"}
      className="w-6/12"
      onClick={handleTransaction}
      disabled={isPending || !address}
    >
      {isPending ? `Processing...` : label}
    </Button>
  );
};

export default WriteButton;
