import {
  AvalancheTokens,
  AvalancheFujiTokens,
  ModeTestnetTokens,
} from "@/constants/Tokens";
import { Avalanche, AvalancheFuji, ModeTestnet } from "@/constants/Chains";
import { IS_MAINNET as isMainnet } from "@/constants/Env";

const CHAIN_CONFIG = {
  // 43114: { chain: Avalanche, tokens: AvalancheTokens },
  43113: { chain: AvalancheFuji, tokens: AvalancheFujiTokens },
  919: { chain: ModeTestnet, tokens: ModeTestnetTokens },
};

export const useGetTokensOrChain = (
  chainId: number,
  type: "tokens" | "chain"
) => {
  const config = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];

  if (!config) return null;

  return type === "tokens" ? config.tokens : config.chain;
};
