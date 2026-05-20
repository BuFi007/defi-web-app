/**
 * Close-perp flow.
 *
 * Closing is just a reduce-only open in the opposite direction. The position
 * size is read from the API; the caller can override with `sizeUsdc` for a
 * partial close.
 */

import type { Hex } from "viem";

import { openPerp, type OpenPerpResult } from "./open";
import type { ChainId } from "../chains";
import type { BufiClient } from "../client";
import { UnknownMarketError } from "../errors";
import { getPositions } from "../queries/positions";
import type { WalletClient, Account } from "viem";

/** Arguments for {@link closePerp}. */
export interface ClosePerpArgs {
  marketId: Hex;
  /**
   * Override the position size to close. If omitted, closes the full
   * position read from `/perps/positions/:address`.
   *
   * Decimal USDC string — e.g. `"5"` for a 5 USDC partial close.
   */
  sizeUsdc?: string;
  /** Override the client's default chain id. */
  chainId?: ChainId;
  walletClient: WalletClient;
  account?: Account;
  signal?: AbortSignal;
}

/**
 * Close a perps position (full or partial). Internally calls {@link openPerp}
 * with `reduceOnly: true` and the inverted side.
 *
 * @throws {UnknownMarketError} if the trader has no open position in this
 *   market and `sizeUsdc` was not provided.
 */
export async function closePerp(
  client: BufiClient,
  args: ClosePerpArgs,
): Promise<OpenPerpResult> {
  const account = args.account ?? args.walletClient.account;
  if (!account) {
    throw new Error("closePerp: walletClient.account is required");
  }

  let inverseSide: "long" | "short" = "short";
  let size = args.sizeUsdc;

  if (!size) {
    const { positions } = await getPositions(client, account.address, {
      signal: args.signal,
    });
    const pos = positions.find((p) => p.marketId.toLowerCase() === args.marketId.toLowerCase());
    if (!pos) throw new UnknownMarketError(args.marketId);
    // sizeDeltaE18 is signed: positive=long → close with short, vice versa.
    const sizeBig = BigInt(pos.sizeDeltaE18);
    inverseSide = sizeBig > 0n ? "short" : "long";
    const magnitude = sizeBig < 0n ? -sizeBig : sizeBig;
    // sizeDeltaE18 is 18dp; sizeUsdc the API expects is 6dp string.
    size = (magnitude / 1_000_000_000_000n).toString();
    // Convert 6dp atomic to decimal-string the quote endpoint understands.
    const whole = BigInt(size) / 1_000_000n;
    const frac = BigInt(size) % 1_000_000n;
    size = `${whole}.${frac.toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
    if (!size) size = "0";
  }

  return openPerp(client, {
    marketId: args.marketId,
    side: inverseSide,
    sizeUsdc: size,
    leverage: 1,
    orderType: "market",
    reduceOnly: true,
    chainId: args.chainId,
    walletClient: args.walletClient,
    account,
    signal: args.signal,
  });
}
