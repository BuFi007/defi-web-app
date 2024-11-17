import { formatUnits } from "viem";
import { UseTokenBalanceProps } from "@/lib/types";
import { erc20Abi } from "viem";
import { useBalance, UseBalanceReturnType } from "wagmi";
import { baseSepolia, avalancheFuji } from "wagmi/chains";
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
      chainId: chainId,
    });
  } else {
    balance = useBalance({
      address: address,
      chainId: chainId,
    });
  }

  return balance;
}
