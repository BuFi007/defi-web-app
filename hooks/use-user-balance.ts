import { useTokenBalances } from "@dynamic-labs/sdk-react-core";
import { formatUnits } from "viem";
import { UseTokenBalanceProps } from "@/lib/types";

export function useTokenBalance({
  tokenAddress,
  chainId,
  address,
  setBalance: externalSetBalance,
}: UseTokenBalanceProps) {
  const { tokenBalances, isLoading, isError } = useTokenBalances({
    accountAddress: address || "0x0",
    tokenAddresses: tokenAddress ? [tokenAddress] : [],
    networkId: chainId || 1,
  });

  const getFormattedBalance = () => {
    if (!tokenAddress || !chainId || !address) {
      return "0";
    }
    
    const balance = tokenBalances?.[0]?.balance || "0";
    const decimals = tokenBalances?.[0]?.decimals || 18;
    const parsedBalance = parseFloat(formatUnits(BigInt(balance), decimals));
    return parsedBalance;
  };


  return {
    balance: Number(getFormattedBalance()),
    isLoading: !tokenAddress || !chainId || !address ? false : isLoading,
    error: isError,
    refetch: null,
  };
}