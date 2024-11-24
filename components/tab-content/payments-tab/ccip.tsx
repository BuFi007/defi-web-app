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
import { Chain, ChainList, Token } from "@/lib/types";
import { useUsdcChain } from "@/hooks/use-usdc-chain";
import {
  useDynamicContext,
  useSwitchNetwork,
} from "@dynamic-labs/sdk-react-core";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { base } from "viem/chains";
import { destinationChains as chains } from "@/constants/CCIP";
import * as Chains from "@/constants/Chains";
export default function CCIPBridge() {
  const { address } = useAccount();
  const chainId = useNetworkManager();
  const { toast } = useToast();
  const tokens = useUsdcChain();
  const [fromAmount, setFromAmount] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [toAmount, setToAmount] = useState<string>("");
  const [sourceChain, setSourceChain] = useState<string | null>(null);
  const switchNetwork = useSwitchNetwork();
  const { primaryWallet } = useDynamicContext();
  const [destinationChain, setDestinationChain] = useState<string | null>(null);
  const destinationChainInfo = getCCIPChainByChainId({
    chainId: Number(destinationChain) as ChainList,
  });
  console.log(destinationChain, "destinationChain");
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
    if (sourceChain !== destinationChain) {
      toast({
        title: "Switching Network",
        description: `Switching network to ${destinationChain}. Please check your wallet to allow network change.`,
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
    const amount = parseUnits(toAmount, tokens?.decimals!);
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
        tokens?.address! as Hex,
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
        tokens?.address!,
        amount
      );

      await tx.wait();
      toast({
        title: "Transaction sent",
        description: "Transaction sent successfully",
        variant: "default",
      });
    } catch (error) {
      console.log({ error });
    }
  }

  const allChains = Object.values(Chains);
  const chainsArray = allChains.filter((chain) =>
    chains.map((c) => c.chainId).includes(chain.chainId)
  );

  console.log(chainsArray, "chainsArray");

  return (
    <div className="border p-2 rounded-xl ">
      <div className="flex flex-col items-center gap-10 text-nowrap w-5/12 m-auto">
        <h2 className="text-center text-xl font-nupower font-bold">
          CCIP USDC Bridge 🔄
        </h2>
        <div className="flex flex-col items-center gap-10 text-nowrap ">
          <ChainSelect
            value={chainId?.toString() ?? ""}
            onChange={(value) => {
              setSelectedToken("");
              setFromAmount("");
              // if (chainId === value) {
              //   toast({
              //     title: "Already on this chain",
              //     description: "You are already on this chain",
              //     variant: "destructive",
              //   });
              // } else {
              switchNetwork({
                wallet: primaryWallet!,
                network: value,
              });
              setSourceChain(value);
              //}
            }}
            chains={chainsArray}
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
            chains={chainsArray.filter(
              (chain) => Number(chain.chainId) !== Number(chainId)
            )}
            label="Bridge USDC to:"
          />
        </div>
        <SwapAmountInput
          label="Sell"
          swappableTokens={tokens ? [tokens] : undefined}
          token={tokens ? tokens : undefined}
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
