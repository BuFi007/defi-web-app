import { AvalancheTokens, BaseTokens } from "@/constants/Tokens";
import { Avalanche, Base, Arbitrum } from "@/constants/Chains";

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain"
) => {
  if (type === "tokens") {
    if (chainId === 43113) return AvalancheTokens;
    if (chainId === 84532) return BaseTokens;
  }
  if (type === "chain") {
    if (chainId === 43113) return Avalanche;
    if (chainId === 84532) return Base;
    if (chainId === 42161) return Arbitrum;
  }
};
