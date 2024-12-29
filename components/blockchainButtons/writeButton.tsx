import React from "react";
import { cn } from "@/utils/index";
import { Button } from "../ui/button";
import { toast } from "../ui/use-toast";
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

  const { isLoading, error, isSuccess, isError, data } =
    useWaitForTransactionReceipt({
      hash,
    });
  console.log(functionName, "functionName");

  return (
    <Button
      variant={"paez"}
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
      {isLoading || isPending ? `Processing... ${label}` : label}
    </Button>
  );
};

export default WriteButton;
