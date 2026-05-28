/**
 * Canonical "which stablecoin lives where" table.
 *
 * Source of truth for every (chainId, asset) -> ERC-20 address lookup
 * across the codebase. Before this file existed the same facts lived in:
 *   - apps/web/components/stablecoin-balances/deployments.ts (SPOKE_CHAINS)
 *   - apps/web/components/trade-island/loan.tsx (loanTokenDeployment fallback)
 *   - whatever any future component would have inlined
 *
 * Sources:
 *   USDC + EURC: developers.circle.com/stablecoins/usdc-contract-addresses
 *                + developers.circle.com/stablecoins/eurc-contract-addresses
 *   MXNB:        Bitso issuer-controlled testnet contracts (per
 *                fx-telarana#feat/mxnb-fuji-markets PR description)
 *   AUDF:        Forte canonical (same address 0xd2a5...7456b on Arc
 *                Testnet, Eth Sepolia AND all mainnets per Forte). The
 *                Arc-side faucet 0x14e1...2213e at AUDFFaucet exposes
 *                public `mint(address,uint256)` -- testnet-only.
 *
 * Note on Fuji EURC: the on-chain Morpho M1/M2 markets use the MockEURC
 * contract (0x50c4ba...194992) shipped under contracts/. This file lists
 * Circle's canonical real testnet EURC (0x5E44db...815c6B) because that's
 * what end users actually hold and the wallet popover needs to read. The
 * two addresses are NOT interchangeable; faucet-minted Circle EURC won't
 * spend in the M1/M2 markets, and vice versa. When the protocol migrates
 * the markets to Circle EURC, this table stays the same; only the
 * @bufi/contracts manifest flips.
 */

import type { StableTokenType } from "./stable-tokens";

/** Hex-string address. Re-declared locally so this module stays
 *  dependency-free (no viem import in @bufi/location). */
export type Address = `0x${string}`;

export type StablecoinDeployment = {
  /** ERC-20 contract address. */
  address: Address;
  /** ERC-20 `decimals()` value -- atomic-unit precision. Defaults to 6
   *  for every stable we ship today; set explicitly when a chain uses a
   *  non-6 representation (USDC on Arc native gas is 18, etc.). */
  decimals: number;
};

/**
 * chainId -> asset -> deployment. Partial<> on the inner record because
 * not every chain carries every stable; query helpers return null for
 * (chain, asset) pairs that aren't deployed yet.
 */
const DEPLOYMENTS: Record<
  number,
  Partial<Record<StableTokenType, StablecoinDeployment>>
> = {
  // Avalanche Fuji (43113) -- hub.
  43113: {
    USDC: { address: "0x5425890298aed601595a70AB815c96711a31Bc65", decimals: 6 },
    EURC: { address: "0x5E44db7996c682E92a960b65AC713a54AD815c6B", decimals: 6 },
    JPYC: { address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", decimals: 18 },
    MXNB: { address: "0xAB99d44185af87AeB08361588F00F59B0CE85eBb", decimals: 6 },
  },
  // Arc Testnet (5042002) -- hub. USDC is a special precompile at
  // 0x36...0000 (native gas-token bridge); we treat it as a 6-dp ERC-20
  // for balance reads, which works through viem's standard contract path.
  //
  // Live on Arc Testnet per @bufi/contracts CONTRACTS[5042002].tokens
  // (sprint-1 broadcast 2026-05-21):
  //   USDC, EURC, JPYC, MXNB, cirBTC, AUDF.
  // BRAVO iter-1 noted "only 4 PERP markets live" (EURC, JPYC, MXNB,
  // cirBTC) — that's about derivative markets, not ERC20 deployments.
  // The AUDF ERC20 is deployed on Arc (user holds ~10M, lending +
  // approval flows confirmed live); the perp market for AUDF just
  // hasn't been listed yet. cirBTC is 8 dp (BTC satoshi precision),
  // NOT 6 — using 6 here displayed balances 100x too large.
  //
  5042002: {
    USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
    EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
    JPYC: { address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", decimals: 18 },
    MXNB: { address: "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461", decimals: 6 },
    QCAD: { address: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d", decimals: 6 },
    CIRBTC: { address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8 },
    AUDF: { address: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b", decimals: 6 },
  },
  // Ethereum Sepolia (11155111) -- spoke.
  11155111: {
    USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
    EURC: { address: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4", decimals: 6 },
    JPYC: { address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", decimals: 18 },
    MXNB: { address: "0x34D4CeBB03Af55b99B68342Ac4bD78e598D9A9fC", decimals: 6 },
    AUDF: { address: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b", decimals: 6 },
  },
  // Arbitrum Sepolia (421614) -- spoke. Circle does NOT deploy EURC on
  // this chain per developers.circle.com -- only USDC + Bitso-issued MXNB.
  421614: {
    USDC: { address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", decimals: 6 },
    MXNB: { address: "0xb56E3E3769EfB85214Cb4fA42eBA198E9FDA92bf", decimals: 6 },
  },
};

/**
 * (chainId, asset) -> deployment. Returns null when the asset isn't
 * deployed on the chain yet, so call sites can render a Pending row
 * without a separate guard.
 */
export function getDeployment(
  chainId: number,
  asset: StableTokenType,
): StablecoinDeployment | null {
  return DEPLOYMENTS[chainId]?.[asset] ?? null;
}

/** All deployments on a given chain, in stable-tokens.ts order. */
export function getDeploymentsForChain(
  chainId: number,
): Array<{ asset: StableTokenType; address: Address; decimals: number }> {
  const row = DEPLOYMENTS[chainId];
  if (!row) return [];
  const out: Array<{ asset: StableTokenType; address: Address; decimals: number }> = [];
  for (const asset of Object.keys(row) as StableTokenType[]) {
    const dep = row[asset];
    if (dep) out.push({ asset, ...dep });
  }
  return out;
}

/** All deployments of a given asset, across every chain. */
export function getDeploymentsForAsset(
  asset: StableTokenType,
): Array<{ chainId: number; address: Address; decimals: number }> {
  const out: Array<{ chainId: number; address: Address; decimals: number }> = [];
  for (const chainIdStr of Object.keys(DEPLOYMENTS)) {
    const chainId = Number(chainIdStr);
    const dep = DEPLOYMENTS[chainId]?.[asset];
    if (dep) out.push({ chainId, ...dep });
  }
  return out;
}

/** Chains that carry at least one deployment, in insertion order. */
export const DEPLOYED_CHAIN_IDS: readonly number[] = Object.keys(DEPLOYMENTS).map(Number);
