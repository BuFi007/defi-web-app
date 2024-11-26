import { useCallback } from "react";
import { NATIVE_TOKEN_ADDRESS } from "@/constants/Tokens";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { Token } from "@/lib/types";

export const useDestinationToken = () => {
  const getDestinationTokenAddress = useCallback(
    (tokenSymbol: string, destinationChainId: string | number) => {
      try {
        // Use the existing hook to get tokens for the destination chain
        const destinationTokens = useGetTokensOrChain(
          Number(destinationChainId),
          "tokens"
        );

        if (!destinationTokens) {
          console.warn(`No tokens found for chain ${destinationChainId}`);
          return NATIVE_TOKEN_ADDRESS;
        }
        // Find the matching token by symbol
        let matchingToken;
        if (Array.isArray(destinationTokens)) {
          matchingToken = destinationTokens.filter(
            (token: Token) => token.symbol === tokenSymbol
          );
        } else {
          console.warn(
            `Destination tokens is not an array for chain ${destinationChainId}`
          );
          return NATIVE_TOKEN_ADDRESS;
        }

        if (!matchingToken.length) {
          console.warn(
            `No matching token found for ${tokenSymbol} on chain ${destinationChainId}`
          );
          return NATIVE_TOKEN_ADDRESS;
        }

        return matchingToken[0].address;
      } catch (error) {
        console.error("Error getting destination token address:", error);
        return NATIVE_TOKEN_ADDRESS;
      }
    },
    []
  );

  return getDestinationTokenAddress;
};
