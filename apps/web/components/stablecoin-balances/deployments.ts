import type { Address } from "viem";

import {
  ArbitrumSepolia,
  ArcTestnet,
  AvalancheFuji,
  Sepolia,
} from "@/constants/Chains";
import type { StableTokenType } from "@bufi/location/stable-tokens";
import type { Chain } from "@/lib/types";

/**
 * Single source of truth for "which stablecoins live on which chain, at
 * what address, with what decimals." Replaces the previous hardcoded
 * arrays scattered across components.
 *
 * Roadmap chains (every spoke we plan to support) appear here even if no
 * token has been deployed to them yet — the UI surfaces them as Pending
 * rows so the multi-chain story is visible from day one. Once a token is
 * deployed on a chain, the only change required is appending a row to
 * `tokens` below.
 *
 * Decimals default to 6 for ERC-20 stables. Override only when a chain
 * uses a non-6 representation (USDC on Arc native gas is 18, for example).
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
  /** Deployed stablecoin addresses on this chain. */
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

// Canonical testnet stablecoin addresses per chain. Sources:
//   USDC + EURC: developers.circle.com/stablecoins/usdc-contract-addresses
//                + developers.circle.com/stablecoins/eurc-contract-addresses
//   MXNB:        Bitso issuer-controlled testnet contracts (per
//                fx-telarana#feat/mxnb-fuji-markets PR description)
//   AUDF:        Forte canonical (same address 0xd2a5…7456b on Arc
//                Testnet, Eth Sepolia AND all mainnets per Forte). The
//                Arc-side faucet 0x14e1…2213e at AUDFFaucet exposes
//                public `mint(address,uint256)` — testnet-only, no
//                bytecode on mainnets.
//
// Note on Fuji EURC: the on-chain Morpho M1/M2 markets use the
// MockEURC contract (0x50c4ba…194992) shipped under contracts/. The
// wallet popover here uses Circle's canonical real testnet EURC
// (0x5E44db…815c6B) because that's what users actually hold. The two
// addresses are NOT interchangeable — a user faucet-minting Circle
// EURC won't see it spendable in the M1/M2 markets, and vice versa.
// When the protocol migrates the markets to Circle EURC this entry
// stays the same; only the contracts/ manifest needs to flip.
export const SPOKE_CHAINS: SpokeChain[] = [
  {
    chainId: 43113,
    label: "Avalanche Fuji",
    role: "hub",
    chain: withLabel(AvalancheFuji),
    isWagmiSupported: true,
    tokens: [
      {
        asset: "USDC",
        address: "0x5425890298aed601595a70AB815c96711a31Bc65",
      },
      {
        asset: "EURC",
        // Circle canonical testnet EURC (NOT the in-protocol MockEURC).
        address: "0x5E44db7996c682E92a960b65AC713a54AD815c6B",
      },
      {
        asset: "MXNB",
        address: "0xAB99d44185af87AeB08361588F00F59B0CE85eBb",
      },
    ],
  },
  {
    chainId: 5042002,
    label: "Arc Testnet",
    role: "hub",
    chain: withLabel(ArcTestnet),
    isWagmiSupported: true,
    tokens: [
      {
        asset: "USDC",
        address: "0x3600000000000000000000000000000000000000",
      },
      {
        asset: "EURC",
        address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      },
      {
        // Forte AUDF — same address on Arc Testnet AND Eth Sepolia. The
        // Arc M3_AUDF_USDC / M4_USDC_AUDF Morpho markets borrow against
        // this token. Faucet is 0x14e1…2213e, public mint.
        asset: "AUDF",
        address: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
      },
    ],
  },
  {
    chainId: 11155111,
    label: "Ethereum Sepolia",
    role: "spoke",
    chain: withLabel(Sepolia),
    isWagmiSupported: true,
    tokens: [
      {
        asset: "USDC",
        // Circle ETH Sepolia USDC. The previous entry was OP Sepolia's
        // USDC (0x5fd842…), mislabeled.
        address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      },
      {
        asset: "EURC",
        address: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
      },
      {
        asset: "MXNB",
        address: "0x34D4CeBB03Af55b99B68342Ac4bD78e598D9A9fC",
      },
      {
        // Forte AUDF — same canonical address as Arc Testnet. Eth
        // Sepolia carries it for cross-chain testing; the M3/M4 Morpho
        // markets only live on Arc for now.
        asset: "AUDF",
        address: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
      },
    ],
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
    tokens: [
      {
        asset: "USDC",
        // Circle Arbitrum Sepolia USDC. Circle does NOT deploy EURC on
        // Arb Sepolia per developers.circle.com — only USDC + the
        // Bitso-issued MXNB.
        address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      },
      {
        asset: "MXNB",
        address: "0xb56E3E3769EfB85214Cb4fA42eBA198E9FDA92bf",
      },
    ],
  },
];
