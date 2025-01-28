import React, { useState } from "react";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { WriteButtonProps } from "@/lib/types";
import { useAccount, useWriteContract } from "wagmi";
import { hubAbi } from "@/constants/ABI"; // Import your ABI
import { erc20Abi, parseUnits } from "viem"; // Use viem for utility functions

const WriteButton = ({
  label,
  contractAddress,
  abi = hubAbi, // Use the imported ABI
  functionName,
  isNative,
  nativeAmount,
  tokenAddress,
}: WriteButtonProps) => {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

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

      const approveTxHash = await writeContractAsync({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress as `0x${string}`, BigInt(parseUnits("3", 18))],
      });

      console.log("Approval transaction sent:", approveTxHash);

      // Llamar a localCompleteAction
      const txHash = await writeContractAsync({
        address: contractAddress as `0x${string}`,
        abi: abi,
        functionName: "localCompleteAction",
        args: [
          {
            action: 0,
            sender: address,
            assetAddress: tokenAddress!,
            assetAmount: BigInt(parseUnits("3", 18)),
          },
        ],
      });

      console.log("Transaction sent:", txHash);

      toast({
        title: "Transaction sent",
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
