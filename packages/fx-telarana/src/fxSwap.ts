/**
 * FX cross-currency swap venue — the canonical Phase 2.5 path.
 *
 * `FxRouter.executeIntent` is the signed-intent + Permit2 entry point that
 * routes a cross-currency FX swap through `FxRouterSwapAdapter` into the
 * vault-backed `FxSwapHook` Uniswap v4 pools (backed by `SharedFxVault`).
 * This module is the single source of truth the app/MCP wire the swap UX to:
 * addresses, pool keys, allowed directional pairs, and the EIP-712 typed-data
 * for building + signing an `FxIntent`.
 *
 * Deployed + wired + smoke-tested on Arc Testnet (5042002). See
 * fx-telarana/deployments/fxswap-vault-backed-v2-5042002.json.
 */
import type { Address, TypedDataDomain } from "viem";

export const FX_SWAP_CHAIN_ID = 5042002 as const;

/** Core venue contracts on Arc Testnet. */
export const FX_SWAP_VENUE = {
  chainId: FX_SWAP_CHAIN_ID,
  fxRouter: "0xd6607B37B7f8eE679E0f4c932560529711f88249",
  swapAdapter: "0xe9147f799C1d65d1bAcFD0fE019d8c46531ef917",
  vault: "0x0E63eff212382F2679c3A363F60e00b7A6d6e3E4",
  oracleV2: "0xdA5Cd65521B64A7375C8d63EeDe52347783cEd74",
  poolManager: "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const satisfies { chainId: number } & Record<string, Address | number>;

export const FX_SWAP_TOKENS = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  AUDF: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
  MXNB: "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461",
  QCAD: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d",
} as const satisfies Record<string, Address>;

export interface FxSwapPool {
  /** Human label, e.g. "USDC/EURC". */
  label: string;
  hook: Address;
  /** v4 sorted currencies (currency0 < currency1). */
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
}

/** The 4 live vault-backed pools (all 0.01% / tickSpacing 1; QCAD inverted). */
export const FX_SWAP_POOLS: readonly FxSwapPool[] = [
  { label: "USDC/EURC", hook: "0x5bA91EB2f67302C947dFD35cC75D1dBcDb2CcAc8", currency0: FX_SWAP_TOKENS.USDC, currency1: FX_SWAP_TOKENS.EURC, fee: 100, tickSpacing: 1 },
  { label: "USDC/AUDF", hook: "0x7Af1ed939C2d4965490f1546b08b07e0BFdA0ac8", currency0: FX_SWAP_TOKENS.USDC, currency1: FX_SWAP_TOKENS.AUDF, fee: 100, tickSpacing: 1 },
  { label: "USDC/MXNB", hook: "0xe9B0cD01eD5F83EEAe98522052Ae3a798dfb8aC8", currency0: FX_SWAP_TOKENS.USDC, currency1: FX_SWAP_TOKENS.MXNB, fee: 100, tickSpacing: 1 },
  { label: "QCAD/USDC", hook: "0x6f80Ab06A4e359e9E6D025105945f02CcC98CAc8", currency0: FX_SWAP_TOKENS.QCAD, currency1: FX_SWAP_TOKENS.USDC, fee: 100, tickSpacing: 1 },
];

/** Directional pairs allowed on the FxRouter (USDC <-> each FX token, both ways). */
export const FX_SWAP_PAIRS: ReadonlyArray<readonly [Address, Address]> = [
  [FX_SWAP_TOKENS.USDC, FX_SWAP_TOKENS.EURC], [FX_SWAP_TOKENS.EURC, FX_SWAP_TOKENS.USDC],
  [FX_SWAP_TOKENS.USDC, FX_SWAP_TOKENS.AUDF], [FX_SWAP_TOKENS.AUDF, FX_SWAP_TOKENS.USDC],
  [FX_SWAP_TOKENS.USDC, FX_SWAP_TOKENS.MXNB], [FX_SWAP_TOKENS.MXNB, FX_SWAP_TOKENS.USDC],
  [FX_SWAP_TOKENS.USDC, FX_SWAP_TOKENS.QCAD], [FX_SWAP_TOKENS.QCAD, FX_SWAP_TOKENS.USDC],
];

export function isFxSwapPairSupported(sellToken: Address, buyToken: Address): boolean {
  const s = sellToken.toLowerCase();
  const b = buyToken.toLowerCase();
  return FX_SWAP_PAIRS.some(([x, y]) => x.toLowerCase() === s && y.toLowerCase() === b);
}

/*//////////////////////////////////////////////////////////////
                  EIP-712 — FxRouter.executeIntent
//////////////////////////////////////////////////////////////*/

/** Matches FxRouterLib.FX_INTENT_TYPEHASH field order/types exactly. */
export const FX_INTENT_TYPES = {
  FxIntent: [
    { name: "taker", type: "address" },
    { name: "recipient", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "minBuyAmount", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "feeBps", type: "uint48" },
    { name: "tenor", type: "uint8" },
    { name: "quoteId", type: "bytes32" },
    { name: "uuid", type: "uint256" },
  ],
} as const;

export const FX_INTENT_TENOR_INSTANT = 0 as const;
/** FxRouterLib.MAX_DEADLINE_FUTURE — intents may not be dated more than 1h out. */
export const FX_INTENT_MAX_DEADLINE_FUTURE_S = 3600 as const;

export function fxIntentDomain(
  fxRouter: Address = FX_SWAP_VENUE.fxRouter as Address,
  chainId: number = FX_SWAP_CHAIN_ID,
): TypedDataDomain {
  return { name: "FxRouter", version: "1", chainId, verifyingContract: fxRouter };
}

export interface FxIntent {
  taker: Address;
  recipient: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  deadline: number;
  feeBps: number;
  tenor: number;
  quoteId: `0x${string}`;
  uuid: bigint;
}

export interface BuildFxIntentParams {
  taker: Address;
  recipient?: Address; // defaults to taker
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  /** Unix seconds the intent is signed at; deadline = nowSeconds + ttlSeconds. */
  nowSeconds: number;
  ttlSeconds?: number; // default 900 (15 min), clamped < 1h
  feeBps?: number; // default 0
  uuid: bigint; // caller supplies a fresh per-taker nonce
  quoteId?: `0x${string}`;
}

/**
 * Build a TENOR_INSTANT FxIntent. Sign with viem `signTypedData({ domain:
 * fxIntentDomain(), types: FX_INTENT_TYPES, primaryType: "FxIntent", message })`,
 * then submit via FxRouter.executeIntent alongside a Permit2 signature.
 */
export function buildFxIntent(p: BuildFxIntentParams): FxIntent {
  const ttl = Math.min(p.ttlSeconds ?? 900, FX_INTENT_MAX_DEADLINE_FUTURE_S - 1);
  return {
    taker: p.taker,
    recipient: p.recipient ?? p.taker,
    sellToken: p.sellToken,
    buyToken: p.buyToken,
    sellAmount: p.sellAmount,
    minBuyAmount: p.minBuyAmount,
    deadline: p.nowSeconds + ttl,
    feeBps: p.feeBps ?? 0,
    tenor: FX_INTENT_TENOR_INSTANT,
    quoteId: p.quoteId ?? (`0x${"00".repeat(32)}` as const),
    uuid: p.uuid,
  };
}
