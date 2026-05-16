import { UseTokenBalanceProps, ChainList } from "@/lib/types";
import { useBalance, UseBalanceReturnType } from "wagmi";
import { toWagmiChainId } from "@/utils/chain";

export function useTokenBalance({
  tokenAddress,
  chainId,
  address,
  setBalance: externalSetBalance,
}: UseTokenBalanceProps): UseBalanceReturnType {
  // ChainList is wider than wagmi's configured chain union — narrow before
  // handing to wagmi. Callers pass ChainList freely; we resolve internally.
  const wagmiChainId = toWagmiChainId(chainId);
  let balance;
  if (tokenAddress !== "0x0000000000000000000000000000000000000000") {
    balance = useBalance({
      address: address,
      token: tokenAddress,
      chainId: wagmiChainId,
    });
  } else {
    balance = useBalance({
      address: address,
      chainId: wagmiChainId,
    });
  }

  return balance;
}
