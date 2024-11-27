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
import { NATIVE_TOKEN_ADDRESS } from "@/constants/Tokens";
import { toast } from "../ui/use-toast";
import { IS_MAINNET } from "@/constants/Env";

const CurrencyDisplayer: React.FC<CurrencyDisplayerProps> = ({
  tokenAmount,
  onValueChange,
  initialAmount = 0,
  availableTokens = [],
  onTokenSelect,
  currentNetwork,
}) => {
  const { width } = useWindowSize();
  let chainId = useChainId();
  const tokens =
    useGetTokensOrChain(currentNetwork, "tokens") || availableTokens;
  const ETH = Array.isArray(tokens)
    ? tokens.find((token: Token) => token?.symbol === "ETH")
    : undefined;
  const supportedChains = Object.values(chains);
  const { address } = useAccount();
  const [usdAmount, setUsdAmount] = useState<number>(0);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [inputValue, setInputValue] = useState<string>(
    initialAmount.toFixed(3)
  );

  useEffect(() => {
    if (ETH && !selectedToken) {
      setSelectedToken(ETH);
    }
  }, [ETH]);

  const balance = useTokenBalance({
    address: address || "0x0",
    chainId: chainId || undefined,
    tokenAddress:
      (selectedToken?.address as `0x${string}`) || NATIVE_TOKEN_ADDRESS,
    decimals: selectedToken?.decimals ?? 18,
  });

  useEffect(() => {
    if (chainId !== currentNetwork) {
      console.warn("Please switch to the correct network.");
    }
  }, [chainId, currentNetwork]);

  const getTokenValue = (token: Token) => {
    if (!token.address) {
      return token.symbol;
    }
    return token.address;
  };
  const handleSelectChange = (value: string) => {
    let token: Token | undefined;
    if (Array.isArray(tokens)) {
      token = tokens.find((t) => t?.address === value || t?.symbol === value);
    }
    if (token) {
      setSelectedToken(token);
      onTokenSelect(token);
      setInputValue("0.0000");
    }
  };

  useEffect(() => {
    setInputValue(tokenAmount?.toFixed(3) || "0.0000");
  }, [tokenAmount]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;

    if (value.length > balance.data?.decimals! + 1) {
      return;
    }
    if (value > getAvailableBalance().toString()) {
      toast({
        title: "Insufficient balance",
        description: "You do not have enough balance to perform this action",
      });
      return;
    }

    if (value === "") {
      setInputValue(value);
      return;
    }

    if (/^\d*\.?\d*$/.test(value)) {
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
    const token = selectedToken;
    if (balance && token) {
      return parseFloat(
        formatUnits(balance.data?.value!, balance.data?.decimals!)
      );
    } else {
      return 0;
    }
  };

  const handleMaxClick = () => {
    const maxBalance = getAvailableBalance().toFixed(6);
    setInputValue(maxBalance);
    updateValues(maxBalance);
  };

  const renderAvailableBalance = () => {
    if (balance.isLoading) {
      return <p className="text-xs">Loading balance...</p>;
    }
    const decimals = selectedToken?.decimals || 18;
    let displayBalance;
    if (decimals > 6) {
      displayBalance = getAvailableBalance().toFixed(4);
    } else {
      displayBalance = getAvailableBalance().toFixed(2);
    }

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

  if (!selectedToken) {
    return <div>Loading...</div>;
  }

  return (
    <div className="mx-auto flex w-80 flex-col items-center">
      <div className="relative mb-2 text-center text-4xl">
        <div className="relative flex justify-center text-6xl">
          <InputMoney
            placeholder="0.0000"
            value={
              selectedToken.decimals > 6
                ? inputValue.slice(0, 10)
                : inputValue.slice(0, 5)
            }
            onChange={handleInputChange}
            className="text-center w-full"
          />
        </div>
        <div className="text-xs text-red-500 mb-2"></div>
      </div>
      <div className="mx-auto mt-2 block text-xs w-full items-center justify-between">
        {renderAvailableBalance()}
      </div>

      <Select onValueChange={handleSelectChange} value={selectedToken.address}>
        <SelectTrigger className="w-full border-transparent flex justify-between">
          <SelectValue>
            {selectedToken && currentNetwork && (
              <div className="flex items-center">
                <img
                  src={selectedToken.image}
                  alt={
                    supportedChains?.find(
                      (chain) => chain.chainId === currentNetwork
                    )?.name || "Ethereum"
                  }
                  className="inline-block w-4 h-4 mr-2"
                />
                {selectedToken.symbol}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-full justify-between">
          {availableTokens?.length > 0 && (
            <SelectGroup className="justify-stretch">
              <SelectLabel>Tokens</SelectLabel>
              {availableTokens
                .filter((token) => token.address)
                .map((token: Token) => (
                  <SelectItem key={token.address} value={getTokenValue(token)}>
                    <TokenChip token={token} />
                  </SelectItem>
                ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};

export default CurrencyDisplayer;
