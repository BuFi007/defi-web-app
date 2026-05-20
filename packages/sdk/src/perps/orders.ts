/**
 * Limit-order helpers. Limit orders go through the same signed-intent
 * pipeline as market orders — the only difference is `orderType: "limit"`
 * and a non-zero `priceE18`.
 *
 * Cancellation is a keeper-side primitive: the matcher tracks nonces, and
 * a trader cancels a limit order by signing a fresh order at the same
 * nonce that supersedes it (the "replacement intent" flow), or by bumping
 * the on-chain nonce.
 *
 * The {@link cancelLimitOrder} helper wraps the replacement-intent endpoint
 * (`/perps/intents/:id/replacement`) with a zero-size payload — equivalent
 * to a `cancelOnly` order.
 */

import type { Hex } from "viem";

import { openPerp, type OpenPerpResult } from "./open";
import type { OpenPerpArgs } from "./open";
import { perpsRest, type BufiClient } from "../client";

/** Arguments for {@link placeLimitOrder}. */
export interface PlaceLimitOrderArgs extends Omit<OpenPerpArgs, "orderType" | "priceE18"> {
  /** Limit price in `priceE18` (18-decimal-fixed-point string). REQUIRED. */
  priceE18: string;
}

/**
 * Place a limit order. Calls {@link openPerp} with `orderType: "limit"`.
 *
 * @example
 * ```ts
 * const { intentId } = await placeLimitOrder(bufi, {
 *   marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
 *   side: "long",
 *   sizeUsdc: "50",
 *   leverage: 3,
 *   priceE18: "1080000000000000000", // 1.08 EUR/USD
 *   walletClient,
 * });
 * ```
 */
export function placeLimitOrder(
  client: BufiClient,
  args: PlaceLimitOrderArgs,
): Promise<OpenPerpResult> {
  return openPerp(client, {
    ...args,
    orderType: "limit",
    priceE18: args.priceE18,
  });
}

/** Arguments for {@link replaceLimitOrder}. */
export interface ReplaceLimitOrderArgs {
  /** Bytes32 intentId of the original order being replaced. */
  intentId: string;
  /** New nonce — MUST be greater than the original. */
  nonce: string;
  /** New deadline, unix seconds. */
  deadline: number;
  /** New `priceE18`. Leave undefined to inherit the original. */
  priceE18?: string;
  /** New size in decimal USDC. Leave undefined to inherit. */
  sizeUsdc?: string;
  /** Wallet signature over the replacement typed-data. */
  signature: Hex;
  /** New order type. */
  orderType?: "limit" | "market";
  reduceOnly?: boolean;
  postOnly?: boolean;
  signal?: AbortSignal;
}

/**
 * Replace an existing limit order with new terms. The keeper enforces
 * nonce monotonicity — pass `nonce: original.nonce + 1`.
 */
export async function replaceLimitOrder(
  client: BufiClient,
  args: ReplaceLimitOrderArgs,
) {
  const rest = perpsRest(client);
  return rest.submitReplacement(
    args.intentId,
    {
      originalIntentId: args.intentId,
      nonce: args.nonce,
      deadline: args.deadline,
      sizeUsdc: args.sizeUsdc,
      orderType: args.orderType,
      priceE18: args.priceE18,
      reduceOnly: args.reduceOnly,
      postOnly: args.postOnly,
      signature: args.signature,
    },
    { signal: args.signal },
  );
}

/**
 * Fetch the typed-data needed to sign a replacement-intent. Pair with
 * {@link replaceLimitOrder} to cancel-and-replace an open limit order.
 */
export async function prepareReplacement(
  client: BufiClient,
  args: {
    intentId: string;
    nonce: string;
    deadline: number;
    priceE18?: string;
    sizeUsdc?: string;
    orderType?: "limit" | "market";
    reduceOnly?: boolean;
    postOnly?: boolean;
    signal?: AbortSignal;
  },
) {
  const rest = perpsRest(client);
  return rest.prepareReplacement(
    args.intentId,
    {
      originalIntentId: args.intentId,
      nonce: args.nonce,
      deadline: args.deadline,
      sizeUsdc: args.sizeUsdc,
      orderType: args.orderType,
      priceE18: args.priceE18,
      reduceOnly: args.reduceOnly,
      postOnly: args.postOnly,
    },
    { signal: args.signal },
  );
}
