// CurrencyDisplayer.tsx

import React, { useState, ChangeEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { InputMoney } from "../ui/input";
import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { useWindowSize } from "@/hooks/use-window-size";
import { CurrencyDisplayerProps, Token } from "@/lib/types";
import * as chains from "@/constants/Chains";
import { TokenChip } from "../token-chip";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useTokenBalance } from "@/hooks/use-user-balance";

const chainIcons: { [key: number]: string } = {
  11155111: "/icons/ethereum-eth-logo.svg",
  84532: "/icons/base-logo-in-blue.svg",
  43113: "/icons/avalanche-avax-logo.svg",
};

const CurrencyDisplayer: React.FC<CurrencyDisplayerProps> = ({
  tokenAmount,
  onValueChange,
  initialAmount = 0,
  availableTokens,
  onTokenSelect,
  currentNetwork,
}) => {
  const { width } = useWindowSize();
  const chainId = useChainId();
  const tokens = useGetTokensOrChain(chainId, "tokens") as Token[];
  const ETH = tokens?.find((token) => token.symbol === "ETH");
  const supportedChains = Object.values(chains);
  const isMobile = width && width <= 768;
  const { address } = useAccount();
  const [usdAmount, setUsdAmount] = useState<number>(0);
  const [selectedToken, setSelectedToken] = useState<Token>(ETH!);
  const [inputValue, setInputValue] = useState<string>(
    initialAmount.toFixed(3)
  );

  const { balance, isLoading: wagmiLoading } = useTokenBalance({
    address: address as `0x${string}`,
    chainId,
    tokenAddress: selectedToken?.address as `0x${string}`,
    decimals: selectedToken?.decimals,
  });

  useEffect(() => {
    if (chainId !== currentNetwork) {
      console.warn("Please switch to the correct network.");
    }
  }, [chainId, currentNetwork]);

  const handleSelectChange = (value: string) => {
    const tokenSymbol = value.toUpperCase();
    const token = tokens?.find((token) => token?.symbol === tokenSymbol);
    setSelectedToken(token!);
    onTokenSelect(token!);
  };

  useEffect(() => {
    setInputValue(tokenAmount?.toFixed(3) || "0.0000");
  }, [tokenAmount]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    if (/^\d*\.?\d*$/.test(value) || value === "") {
      setInputValue(value);
      const numericValue = parseFloat(value);
      onValueChange(numericValue || 0, numericValue);
    }
  };

  const updateValues = (value: string) => {
    const numericValue = parseFloat(value);
    if (!isNaN(numericValue)) {
      onValueChange(0, numericValue);
    } else {
      onValueChange(0, 0);
    }
  };

  const getAvailableBalance = () => {
    const token = tokens?.find(
      (token) => token.address === selectedToken.address
    );
    if (balance) {
      return parseFloat(formatUnits(BigInt(balance), token?.decimals || 18));
    }
    return 0;
  };

  const handleMaxClick = () => {
    const maxBalance = getAvailableBalance().toFixed(6);
    setInputValue(maxBalance);
    updateValues(maxBalance);
  };

  const renderAvailableBalance = () => {
    if (wagmiLoading) {
      return <p className="text-xs">Loading balance...</p>;
    }
    const displayBalance = getAvailableBalance().toFixed(6);
    return (
      <>
        <Button variant={"link"} className="text-xs" onClick={handleMaxClick}>
          Available balance (Max):
        </Button>
        <Button variant={"link"} className="text-xs" onClick={handleMaxClick}>
          {displayBalance} {selectedToken?.symbol}
        </Button>
      </>
    );
  };

  return (
    <div className="mx-auto flex w-52 flex-col items-center">
      <div className="relative mb-2 text-center text-4xl">
        <div className="relative flex justify-center text-6xl">
          <InputMoney
            placeholder="0.0000"
            value={inputValue}
            onChange={handleInputChange}
            className="text-center w-full"
          />
        </div>
        <div className="text-xs text-red-500 mb-2"></div>
      </div>
      <div className="mx-auto mt-2 block text-xs w-full items-center justify-between">
        {renderAvailableBalance()}
      </div>

      <Select
        onValueChange={handleSelectChange}
        value={selectedToken?.symbol?.toLowerCase()}
      >
        <SelectTrigger className="w-full border-transparent flex justify-between">
          <SelectValue>
            {selectedToken && currentNetwork && (
              <div className="flex items-center">
                <img
                  src={chainIcons[currentNetwork]}
                  alt={
                    supportedChains?.find(
                      (chain) => chain.chainId === currentNetwork
                    )?.name || "Ethereum"
                  }
                  className="inline-block w-4 h-4 mr-2"
                />
                {selectedToken?.symbol}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-full justify-between">
          <SelectGroup className="justify-stretch">
            <SelectLabel>Tokens</SelectLabel>
            {availableTokens?.map((token) => (
              <SelectItem key={token.address} value={token.address}>
                <TokenChip token={availableTokens[token as any]} />
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Native Token</SelectLabel>
            <SelectItem value="eth">
              <TokenChip token={ETH!} /> ETH
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};

export default CurrencyDisplayer;
