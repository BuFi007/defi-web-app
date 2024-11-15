import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { Token } from "@/lib/types";

export const useUsdcTokenChain = (chainId: number) => {
  const tokens = useGetTokensOrChain(chainId, "tokens") as Token[];
  const USDC = tokens?.find((token) => token.symbol === "USDC");
  return USDC;
};
