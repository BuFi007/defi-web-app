"use client";

import React, { useState } from "react";

import { SwapToggleButton } from "@/components/swap/components/swapToggleButton";
import { SwapAmountInput } from "@/components/swap/components/swapAmountInput";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { cn } from "@/utils";
import { getCCIPChainByChainId } from "@/constants/CCIP";
import { ChainSelect } from "@/components/chain-select";
import { erc20Abi, Hex } from "viem";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CCIPTransferAbi } from "@/constants/ABI";
import { useEthersSigner } from "@/lib/wagmi";
import { parseUnits } from "viem";
import { useToast } from "@/components/ui/use-toast";
import { Chain, Token } from "@/lib/types";
import { useUsdcChain } from "@/hooks/use-usdc-chain";
import {
  useDynamicContext,
  useSwitchNetwork,
} from "@dynamic-labs/sdk-react-core";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { base } from "viem/chains";
import { destinationChains as chains } from "@/constants/CCIP";

export default function CCIPBridge() {
  const { address } = useAccount();
  const chainId = useNetworkManager();
  const { toast } = useToast();
  const tokens = useUsdcChain(chainId);
  const [fromAmount, setFromAmount] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [toAmount, setToAmount] = useState<string>("");
  const [sourceChain, setSourceChain] = useState<string | null>(null);
  const switchNetwork = useSwitchNetwork();
  const { primaryWallet } = useDynamicContext();
  const [destinationChain, setDestinationChain] = useState<string | null>(null);
  const destinationChainInfo = getCCIPChainByChainId({
    chainId: Number(destinationChain),
  });
  const signer = useEthersSigner();

  const actualChain = getCCIPChainByChainId({ chainId });

  if (!address) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="font-nupower text-xl">Please connect your wallet</div>
      </div>
    );
  }

  const handleFromAmountChange = (amount: string) => {
    setFromAmount(amount);
  };

  const handleToAmountChange = (amount: string, selectedToken: Token) => {
    setToAmount(amount);
  };

  function handleToggle() {
    if (sourceChain && destinationChain && sourceChain === destinationChain) {
      console.warn("Source and destination chains cannot be the same.");
      return;
    }

    if (sourceChain !== destinationChain) {
      const destinationChainName =
        chains.find((chain) => chain.chainId === Number(sourceChain))?.name ||
        `Chain ID ${destinationChain}`;

      toast({
        title: "Switching Network",
        description: `Switching network to ${destinationChainName}. Please check your wallet to allow network change.`,
      });

      switchNetwork({
        wallet: primaryWallet!,
        network: Number(destinationChain),
      });
      setSourceChain(destinationChain);
      setDestinationChain(sourceChain);
    } else {
      setSourceChain(String(chainId));
      setDestinationChain(null);
    }
  }

  async function sendCCIPTransfer() {
    const amount = parseUnits(toAmount, tokens?.[0]?.decimals!);
    if (!destinationChainInfo?.ccipChainId) {
      toast({
        title: "Invalid Destination Chain",
        description: "Please select a valid destination chain",
        variant: "destructive",
        className: "bg-red-500 text-white",
      });
      return;
    }
    try {
      const contractERC20 = new ethers.Contract(
        tokens?.[0]?.address! as Hex,
        erc20Abi,
        signer
      );

      const contract = new ethers.Contract(
        actualChain?.address as Hex,
        CCIPTransferAbi,
        signer
      );
      const allowance = await contractERC20.allowance(
        address,
        actualChain?.address as Hex
      );

      if (allowance < amount) {
        const txApprove = await contractERC20.approve(
          actualChain?.address as Hex,
          amount
        );
        await txApprove.wait();
      }

      const tx = await contract.transferTokensPayLINK(
        destinationChainInfo?.ccipChainId,
        address,
        tokens?.[0]?.address!,
        amount
      );

      toast({
        title: "Transaction sent",
        description: "Transaction sent successfully",
        variant: "default",
      });
    } catch (error) {
      console.log({ error });
    }
  }

  return (
    <div className="border p-2 rounded-xl ">
      <div className="flex flex-col items-center gap-10 text-nowrap w-5/12 m-auto">
        <h2 className="text-center text-xl font-nupower font-bold">
          CCIP USDC Bridge 🔄
        </h2>
        <div className="flex flex-col items-center gap-10 text-nowrap ">
          <ChainSelect
            value={sourceChain ? sourceChain : chainId?.toString() ?? ""}
            onChange={(value) => {
              setSelectedToken("");
              setFromAmount("");
              console.log({ value });
              if (chainId === value) {
                setSourceChain(null);
              } else {
                switchNetwork({
                  wallet: primaryWallet!,
                  network: Number(value),
                });
                setDestinationChain(null);
                setSourceChain(value);
              }
            }}
            chains={chains}
            label="Source Chain"
          />
          <div className="relative w-full flex justify-center items-center ">
            <SwapToggleButton
              className="bg-main border-2 border-border dark:border-white rounded-full shadow-light dark:shadow-dark hover:bg-clr-yellow"
              handleToggle={handleToggle}
            />
          </div>
          <ChainSelect
            value={destinationChain}
            onChange={(value) => {
              setSelectedToken("");
              setFromAmount("");
              console.log(value, "value");
              console.log(chainId, "chainId");
              if (Number(value) !== chainId) {
                setDestinationChain(value);
              } else {
                return;
              }
            }}
            chains={chains}
            label="Bridge USDC to:"
          />
        </div>
        <SwapAmountInput
          label="Sell"
          swappableTokens={tokens}
          token={tokens?.[0]}
          amount={toAmount}
          setAmount={setToAmount}
          className={cn(
            "mb-2 p-3 w-full bg-card dark:bg-darkCard border-2 border-border dark:border-darkBorder rounded-xl ",
            "focus-within:shadow-light dark:focus-within:shadow-dark"
          )}
          address={address || ""}
          handleAmountChange={handleFromAmountChange}
          amountUSD={"100"}
          loading={false}
        />

        <Button variant={"brutalism"} onClick={sendCCIPTransfer}>
          Bridge
        </Button>
      </div>
    </div>
  );
}
