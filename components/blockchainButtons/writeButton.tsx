import React, { useState } from "react";
import { ethers } from "ethers";
import { cn } from "@/utils/index";
import { Button } from "../ui/button";
import { useEthersSigner } from "@/lib/wagmi";
import { toast } from "../ui/use-toast";
import { WriteButtonProps } from "@/lib/types";

const WriteButton = ({
  label,
  contractAddress,
  abi,
  functionName,
  args,
}: WriteButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const signer = useEthersSigner();

  const handleWrite = async () => {
    setIsLoading(true);
    try {
      const contract = new ethers.Contract(contractAddress, abi, signer);

      const tx = await contract[functionName](...args);
      console.log("Transaction sent:", tx);

      const receipt = await tx.wait();

      toast({
        title: "Transaction confirmed",
        description: "Transaction confirmed",
        variant: "default",
      });
      console.log("Transaction confirmed:", receipt);
    } catch (error) {
      toast({
        title: "Transaction failed",
        description: "Transaction failed",
        variant: "destructive",
      });
      console.error("Transaction failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button variant={"brutalism"} onClick={handleWrite} disabled={isLoading}>
      {isLoading ? `Processing... ${label}` : label}
    </Button>
  );
};

export default WriteButton;
