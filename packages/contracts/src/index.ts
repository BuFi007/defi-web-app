/**
 * Per-chain contract address book.
 *
 * The deployed addresses are intentionally TBD — they get populated as
 * each Solidity worktree (perps, fx-bento, fx-telarana) ships. Ponder +
 * the API both read from this map so there's a single source of truth
 * for what's live on which chain.
 */

import type { Address } from "viem";

import type { ChainId } from "@bufi/shared-types";

export interface ChainContracts {
  /** Perps registry / position manager. */
  perps?: Address;
  /** FX² Arcade / FX Bento escrow + room manager. */
  bento?: Address;
  /** FX Telaraña lending vault factory. */
  telarana?: Address;
  /** USDC. */
  usdc?: Address;
  /** Other stablecoins. */
  eurc?: Address;
  mxnb?: Address;
  brl?: Address;
  jpyc?: Address;
  qcad?: Address;
}

export const CONTRACTS: Record<ChainId, ChainContracts> = {
  43113: {
    // Avalanche Fuji testnet
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" as Address,
  },
  919: {
    // Mode Sepolia
  },
  5042002: {
    // Arc Testnet
  },
};

/**
 * Merge env-var overrides at load time. `CONTRACT_ADDRESSES_JSON` is a
 * JSON blob like `{"43113":{"perps":"0x..."}}` so a deploy doesn't need
 * a code change to register a new address.
 */
export function loadContracts(): Record<ChainId, ChainContracts> {
  const raw = process.env.CONTRACT_ADDRESSES_JSON;
  if (!raw) return CONTRACTS;
  try {
    const overrides = JSON.parse(raw) as Partial<Record<ChainId, ChainContracts>>;
    const merged = { ...CONTRACTS };
    for (const [k, v] of Object.entries(overrides)) {
      const cid = Number(k) as ChainId;
      merged[cid] = { ...merged[cid], ...v };
    }
    return merged;
  } catch (e) {
    throw new Error(
      `@bufi/contracts: failed to parse CONTRACT_ADDRESSES_JSON: ${(e as Error).message}`,
    );
  }
}
