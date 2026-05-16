import {
  AvalancheFujiTokens,
  ArcTestnetTokens,
  ModeTestnetTokens,
} from "@/constants/Tokens";
import { ArcTestnet, AvalancheFuji, ModeTestnet } from "@/constants/Chains";

const CHAIN_CONFIG = {
  43113: { chain: AvalancheFuji, tokens: AvalancheFujiTokens },
  919: { chain: ModeTestnet, tokens: ModeTestnetTokens },
  5042002: { chain: ArcTestnet, tokens: ArcTestnetTokens },
};

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain"
) => {
  const config = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];

  if (!config) return null;

  return type === "tokens" ? config.tokens : config.chain;
};
