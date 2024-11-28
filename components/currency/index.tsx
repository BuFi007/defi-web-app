import React, { useState, ChangeEvent, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils";
import { InputMoney } from "../ui/input";
import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { CurrencyDisplayerProps, Token } from "@/lib/types";
import * as chains from "@/constants/Chains";
import { TokenChip } from "../token-chip";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useTokenBalance } from "@/hooks/use-user-balance";
import { NATIVE_TOKEN_ADDRESS } from "@/constants/Tokens";
import { toast } from "../ui/use-toast";
import { sizeStyles } from "@/lib/utils";

const CurrencyDisplayer: React.FC<CurrencyDisplayerProps> = ({
  tokenAmount,
  onValueChange,
  initialAmount = 0,
  availableTokens = [],
  onTokenSelect,
  currentNetwork,
  size = "base",
  action = "request",
  defaultToken = undefined,
}) => {
  let chainId = useChainId();
  const tokens =
    useGetTokensOrChain(currentNetwork, "tokens") || availableTokens;
  const ETH = Array.isArray(tokens)
    ? tokens.find((token: Token) => token?.symbol === "ETH")
    : undefined;
  const supportedChains = Object.values(chains);
  const { address } = useAccount();
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  console.log(selectedToken, "selectedToken");
  console.log(defaultToken, "defaultTokeadsdsn");
  const [inputValue, setInputValue] = useState<string>(
    (tokenAmount || initialAmount).toFixed(3)
  );

  useEffect(() => {
    if (ETH && !selectedToken && !defaultToken) {
      setSelectedToken(ETH);
    } else if (defaultToken) {
      setSelectedToken(defaultToken);
    }
  }, [ETH, defaultToken]);

  useEffect(() => {
    if (tokenAmount !== undefined) {
      setInputValue(tokenAmount.toFixed(3));
    }
  }, [tokenAmount]);

  const balance = useTokenBalance({
    address: address || "0x0",
    chainId: chainId || undefined,
    tokenAddress:
      (selectedToken?.address as `0x${string}`) || NATIVE_TOKEN_ADDRESS,
    decimals: selectedToken?.decimals ?? 18,
  });

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

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;

    if (value === "") {
      setInputValue("");
      onValueChange(0, 0);
      return;
    }

    if (/^\d*\.?\d*$/.test(value)) {
      const numericValue = parseFloat(value);

      // Only check balance for non-payment requests
      if (action === "default") {
        const availableBalance = parseFloat(
          formatUnits(balance.data?.value || 0n, balance.data?.decimals || 18)
        );
        if (numericValue > availableBalance) {
          toast({
            title: "Insufficient balance",
            description:
              "You do not have enough balance to perform this action",
          });
          return;
        }
      }

      setInputValue(value);
      onValueChange(numericValue || 0, numericValue || 0);
    }
  };

  const getTokenValue = (token: Token) => {
    if (!token.address) {
      return token.symbol;
    }
    return token.address;
  };

  if (!selectedToken) {
    return <div>Loading...</div>;
  }

  return (
    <div
      className={cn(
        "mx-auto flex flex-col items-center",
        sizeStyles.container[size]
      )}
    >
      <div className="relative mb-2 text-center">
        <div className="relative flex justify-center">
          <InputMoney
            placeholder="0.0000"
            value={
              selectedToken.decimals > 6
                ? inputValue.slice(0, 10)
                : inputValue.slice(0, 5)
            }
            onChange={handleInputChange}
            className={cn("text-center w-full", sizeStyles.input[size])}
          />
        </div>
        <div className="text-xs text-red-500 mb-2"></div>
      </div>

      <div className="w-full">
        <Select
          onValueChange={handleSelectChange}
          value={selectedToken.address}
        >
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
                    <SelectItem
                      key={token.address}
                      value={getTokenValue(token)}
                    >
                      <TokenChip token={token} />
                    </SelectItem>
                  ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default CurrencyDisplayer;
