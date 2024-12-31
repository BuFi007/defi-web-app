import React, { useEffect } from "react";
import { cn } from "@/utils/index";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { WriteButtonProps } from "@/lib/types";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";

const WriteButton = ({
  label,
  contractAddress,
  abi,
  functionName,
  args,
  isNative,
  nativeAmount,
}: WriteButtonProps) => {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { toast } = useToast();
  const { isLoading, error, isSuccess, isError, data } =
    useWaitForTransactionReceipt({
      hash,
    });

  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Transaction successful",
        description: "Your transaction has been successfully completed.",
      });
    }
  }, [isSuccess]);

  return (
    <Button
      variant={"fito"}
      className=""
      onClick={() =>
        writeContract({
          abi,
          address: contractAddress as `0x${string}`,
          functionName: functionName,
          args: args,
          value:
            isNative && nativeAmount ? parseEther(nativeAmount) : undefined,
        })
      }
      disabled={isLoading || isPending}
    >
      {isLoading || isPending ? `Processing...` : label}
    </Button>
  );
};

export default WriteButton;
