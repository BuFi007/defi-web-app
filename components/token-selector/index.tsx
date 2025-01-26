import React from "react";
import { useChainId } from "wagmi";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useMarketStore } from "@/store";
import * as Chains from "@/constants/Chains";
import { CurrencyDisplayerProps, CurrencyInfo, Token } from "@/lib/types";
import { useNetworkStore } from "@/store";
import Image from "next/image";

function getChainInfoByChainId(chainId: number | string) {
  const id = Number(chainId);
  const isMainnet = Object.values(Chains).find(
    (chain) => chain.chainId === id
  )?.isMainnet;
  return { isMainnet };
}

const TokenSelector = ({
  token,
  onValueChange,
  onTokenSelect,
}: CurrencyDisplayerProps) => {
  const chainId = useChainId();
  const { currentChainId } = useNetworkStore();

  const tokens = useGetTokensOrChain(Number(currentChainId), "tokens");

  const filteredTokens = React.useMemo(() => {
    if (!tokens || !Array.isArray(tokens)) return [];

    const currentChainInfo = getChainInfoByChainId(currentChainId || chainId);

    return tokens.filter((token: Token) => {
      const tokenChainInfo = getChainInfoByChainId(token.chainId);
      return tokenChainInfo.isMainnet === currentChainInfo.isMainnet;
    });
  }, [tokens, currentChainId, chainId]);

  const handleTokenSelect = (value: string) => {
    const selectedToken = filteredTokens.find(
      (token: CurrencyInfo) => token.address === value
    );
    if (selectedToken) {
      onTokenSelect(selectedToken);
    }
  };

  React.useEffect(() => {
    if (!token && filteredTokens.length > 0) {
      onTokenSelect(filteredTokens[0]);
    }
  }, [token, filteredTokens, onTokenSelect]);

  if (!filteredTokens || filteredTokens.length === 0) {
    return <div>No tokens available for this network</div>;
  }

  console.log(token, "token");
  return (
    <Select
      onValueChange={handleTokenSelect}
      value={token?.address || ""}
      defaultValue={token?.address || filteredTokens[0]?.address}
    >
      <SelectTrigger className="w-40  bg-white">
        <SelectValue>
          {token ? (
            <div className="flex items-center">
              <Image
                src={token.image || ""}
                alt={token.symbol}
                width={16}
                height={16}
                className="inline-block w-4 h-4 mr-2"
              />
              {token.symbol}
            </div>
          ) : (
            <div className="flex items-center">
              <Image
                src={filteredTokens[0].image || ""}
                alt={filteredTokens[0].symbol}
                width={16}
                height={16}
                className="inline-block w-4 h-4 mr-2"
              />
              {filteredTokens[0].symbol}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>
            Available Assets on{" "}
            {getChainInfoByChainId(currentChainId || chainId).isMainnet
              ? "Mainnet"
              : "Testnet"}
          </SelectLabel>
          {filteredTokens.map((tokens: Token) => (
            <SelectItem key={tokens.address} value={tokens.address}>
              <div className="flex items-center">
                <img
                  src={tokens.image || ""}
                  alt={tokens.symbol}
                  className="inline-block w-4 h-4 mr-2"
                />
                {tokens.symbol}
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export default TokenSelector;
