import { UseTokenBalanceProps, ChainList } from "@/lib/types";
import { useBalance, UseBalanceReturnType } from "wagmi";

export function useTokenBalance({
  tokenAddress,
  chainId,
  address,
  setBalance: externalSetBalance,
}: UseTokenBalanceProps): UseBalanceReturnType {
  console.log(tokenAddress, "tokenAddress");
  let balance;
  if (tokenAddress !== "0x0000000000000000000000000000000000000000") {
    balance = useBalance({
      address: address,
      token: tokenAddress,
      chainId: chainId as ChainList,
    });
  } else {
    balance = useBalance({
      address: address,
      chainId: chainId as ChainList,
    });
  }

  return balance;
}
