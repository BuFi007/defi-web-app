import React from 'react';
import { useChainId } from 'wagmi';
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
import { CurrencyInfo, Token } from "@/lib/types";
import { useNetworkStore } from "@/store";
import Image from 'next/image';


function getChainInfoByChainId(chainId: number | string) {
  const id = Number(chainId);
  const isMainnet = Object.values(Chains).find(
    (chain) => chain.chainId === id
  )?.isMainnet;
  return { isMainnet };
}

const TokenSelector = () => {
  const chainId = useChainId();
  const { selectedAsset, setSelectedAsset } = useMarketStore();
  const { currentChainId } = useNetworkStore();
  
  // Get available tokens from the hook
  const tokens = useGetTokensOrChain(
    Number(currentChainId), 
    "tokens"
  );

  // Filter tokens based on mainnet/testnet status
  const filteredTokens = React.useMemo(() => {
    if (!tokens || !Array.isArray(tokens)) return [];
    
    const currentChainInfo = getChainInfoByChainId(currentChainId || chainId);
    
    return tokens.filter((token: Token) => {
      const tokenChainInfo = getChainInfoByChainId(token.chainId);
      // Only show tokens that match the current chain's mainnet/testnet status
      return tokenChainInfo.isMainnet === currentChainInfo.isMainnet;
    });
  }, [tokens, currentChainId, chainId]);

  const handleTokenSelect = (value: string) => {
    const selectedToken = filteredTokens.find((token: CurrencyInfo) => token.address === value);
    if (selectedToken) {
      setSelectedAsset(selectedToken);
    }
  };

  if (!filteredTokens || filteredTokens.length === 0) {
    return <div>No tokens available for this network</div>;
  }

  return (
    <Select 
      onValueChange={handleTokenSelect} 
      value={selectedAsset?.address || ''}
      defaultValue={selectedAsset?.address || filteredTokens[0]?.address}
    >
      <SelectTrigger className="w-40 border-transparent">
        <SelectValue>
          {selectedAsset && (
            <div className="flex items-center">
              <Image
                src={selectedAsset.image || ''}
                alt={selectedAsset.symbol}
                className="inline-block w-4 h-4 mr-2"
              />
              {selectedAsset.symbol}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>
            Available Assets on {getChainInfoByChainId(currentChainId || chainId).isMainnet ? 'Mainnet' : 'Testnet'}
          </SelectLabel>
          {filteredTokens.map((token: Token) => (
            <SelectItem key={token.address} value={token.address}>
              <div className="flex items-center">
                <img
                  src={token.image || ''}
                  alt={token.symbol}
                  className="inline-block w-4 h-4 mr-2"
                />
                {token.name}
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export default TokenSelector;