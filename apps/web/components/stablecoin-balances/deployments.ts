import type { Address } from "viem";

import {
  ArbitrumSepolia,
  ArcTestnet,
  AvalancheFuji,
  Sepolia,
} from "@/constants/Chains";
import type { StableTokenType } from "@bufi/location/stable-tokens";
import { getDeploymentsForChain } from "@bufi/location/deployments";
import type { Chain } from "@/lib/types";

/**
 * SPOKE_CHAINS pairs the platform-level deployment table
 * (@bufi/location/deployments — pure data, no env deps) with the
 * apps/web Chain config (RPC URLs, explorer URLs, env-keyed Alchemy
 * fragment) so the wallet popover has everything it needs in one
 * record per chain.
 *
 * The deployment list per chain comes from the central table; the
 * chain config + wagmi support flag stay here because they're
 * Next.js-specific (process.env-backed RPCs). Adding a stablecoin to
 * an existing chain is now a one-line edit in
 * packages/location/src/deployments.ts.
 */
export type StablecoinDeployment = {
  asset: StableTokenType;
  address: Address;
  decimals?: number;
};

export type SpokeChain = {
  /** Numeric chain id. */
  chainId: number;
  /** Display label — overrides `Chain.name` because Avalanche Fuji's `name`
   *  collides with mainnet's. */
  label: string;
  /** Hub vs spoke role. Used for grouping in the UI. */
  role: "hub" | "spoke";
  /** `@/lib/types` `Chain` shape — fed to `ChainSelect` and `TokenChip`. */
  chain: Chain;
  /** Whether wagmi knows this chain id. Chains not in the wagmi config
   *  can't be read via `useBalance` and will render as Pending. */
  isWagmiSupported: boolean;
  /** Deployed stablecoin addresses on this chain — derived from the
   *  central table at module-load. */
  tokens: StablecoinDeployment[];
};

const withLabel = (
  c:
    | typeof AvalancheFuji
    | typeof ArcTestnet
    | typeof Sepolia
    | typeof ArbitrumSepolia,
): Chain => ({
  ...(c as Chain),
  name: c.vanityName ?? c.name,
});

/** Project deployments-from-the-package into the legacy shape that
 *  SPOKE_CHAINS expected. Keeps `decimals` optional so existing call
 *  sites that read `.decimals ?? 6` continue to compile. */
const tokensFor = (chainId: number): StablecoinDeployment[] =>
  getDeploymentsForChain(chainId).map((d) => ({
    asset: d.asset,
    address: d.address as Address,
    decimals: d.decimals,
  }));

export const SPOKE_CHAINS: SpokeChain[] = [
  {
    chainId: 43113,
    label: "Avalanche Fuji",
    role: "hub",
    chain: withLabel(AvalancheFuji),
    isWagmiSupported: true,
    tokens: tokensFor(43113),
  },
  {
    chainId: 5042002,
    label: "Arc Testnet",
    role: "hub",
    chain: withLabel(ArcTestnet),
    isWagmiSupported: true,
    tokens: tokensFor(5042002),
  },
  {
    chainId: 11155111,
    label: "Ethereum Sepolia",
    role: "spoke",
    chain: withLabel(Sepolia),
    isWagmiSupported: true,
    tokens: tokensFor(11155111),
  },
  {
    chainId: 421614,
    label: "Arbitrum Sepolia",
    role: "spoke",
    chain: {
      ...(ArbitrumSepolia as Chain),
      name: ArbitrumSepolia.vanityName,
    },
    isWagmiSupported: true,
    tokens: tokensFor(421614),
  },
];
