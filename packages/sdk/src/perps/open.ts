/**
 * Open-perp flow: quote → typed-data → sign → submit intent.
 *
 * This is the canonical "fire-and-forget" entry point integrators use. The
 * keeper picks up the signed intent and matches it on-chain; the returned
 * `intentId` is the receipt the caller polls via {@link getIntent}.
 */

import type { Account, Hex, WalletClient } from "viem";

import type {
  PerpsIntentResponse,
  PerpsQuoteResponse,
} from "@bufi/perps/schemas";
import { buildPerpsOrderTypedData } from "@bufi/perps";

import { perpsRest, type BufiClient } from "../client";
import {
  BufiApiError,
  OracleStaleError,
  SignatureError,
} from "../errors";
import type { ChainId } from "../chains";

/** Arguments for {@link openPerp}. */
export interface OpenPerpArgs {
  /** Bytes32 marketId from `@bufi/contracts` (e.g. `ARC_PERP_MARKETS["EURC/USDC"].marketId`). */
  marketId: Hex;
  side: "long" | "short";
  /** USDC notional as a decimal string, e.g. `"10"`, `"100.50"`. */
  sizeUsdc: string;
  /** Integer leverage, 1–50. */
  leverage: number;
  /** Order type. Defaults to `"market"`. */
  orderType?: "market" | "limit";
  /** For limit orders — `priceE18` (18-decimal-fixed-point) as a string. */
  priceE18?: string;
  /** Override the client's default chain id. */
  chainId?: ChainId;
  /** Defaults to a 10-minute deadline from now. */
  deadlineSeconds?: number;
  /** Defaults to `"0"` — the keeper will return the actual nonce in the quote. */
  nonce?: string;
  /** Defaults to `false`. */
  reduceOnly?: boolean;
  /** Defaults to `false`. */
  postOnly?: boolean;
  /**
   * The viem `WalletClient` used to sign the typed data. Must have an
   * account attached (`createWalletClient({ account, ... })`).
   */
  walletClient: WalletClient;
  /** Optional account override — defaults to `walletClient.account`. */
  account?: Account;
  /** Caller-driven cancellation. */
  signal?: AbortSignal;
}

/**
 * Result of a successful {@link openPerp} call.
 *
 * The `intentId` is the keeper's reference for this order; the on-chain
 * `txHash` is `undefined` until the matcher emits the fill event.
 */
export interface OpenPerpResult {
  intentId: string;
  digest: Hex;
  status: "accepted" | "rejected";
  /** EIP-712 typed data that was signed (returned by the API). */
  typedData: PerpsIntentResponse["typedData"];
  /** Quote returned during the pre-flight. */
  quote: PerpsQuoteResponse;
  /** Signature submitted to the API. */
  signature: Hex;
}

const DEFAULT_DEADLINE_SECS = 600;
const MAX_ORACLE_STALENESS_SECS = 30;

/**
 * Open a perps position. Does the full quote → sign → submit-intent dance.
 *
 * @throws {BufiApiError} on any non-2xx from the API.
 * @throws {OracleStaleError} if the quote returns a stale oracle. The keeper
 *   refuses to match stale-oracle intents, so this fails fast.
 * @throws {SignatureError} if the wallet refuses to sign.
 *
 * @example
 * ```ts
 * const { intentId } = await openPerp(bufi, {
 *   marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
 *   side: "long",
 *   sizeUsdc: "10",
 *   leverage: 5,
 *   walletClient,
 * });
 * ```
 */
export async function openPerp(
  client: BufiClient,
  args: OpenPerpArgs,
): Promise<OpenPerpResult> {
  const account = args.account ?? args.walletClient.account;
  if (!account) {
    throw new SignatureError(
      "walletClient has no account attached. Pass `walletClient: createWalletClient({ account, ... })`.",
    );
  }

  const chainId = (args.chainId ?? client.chainId) as ChainId;
  if (!chainId) {
    throw new Error("openPerp: chainId is required (set on createBufiClient or pass args.chainId)");
  }

  const rest = perpsRest(client);

  const quote = await rest.quote(
    {
      chainId,
      marketId: args.marketId,
      trader: account.address,
      side: args.side,
      sizeUsdc: args.sizeUsdc,
      leverage: args.leverage,
    },
    { signal: args.signal },
  );

  if (quote.oracleStaleSeconds > MAX_ORACLE_STALENESS_SECS) {
    throw new OracleStaleError({
      marketId: args.marketId,
      ageSeconds: quote.oracleStaleSeconds,
      maxStaleSeconds: MAX_ORACLE_STALENESS_SECS,
    });
  }

  const deadline =
    Math.floor(Date.now() / 1000) + (args.deadlineSeconds ?? DEFAULT_DEADLINE_SECS);
  const nonce = args.nonce ?? "0";
  const orderType = args.orderType ?? "market";

  const typedData = buildPerpsOrderTypedData({
    chainId,
    trader: account.address,
    marketId: args.marketId,
    side: args.side,
    orderType,
    sizeUsdc: args.sizeUsdc,
    leverage: args.leverage,
    priceE18: args.priceE18,
    reduceOnly: args.reduceOnly ?? false,
    postOnly: args.postOnly ?? false,
    nonce,
    deadline,
  });

  let signature: Hex;
  try {
    signature = await args.walletClient.signTypedData({
      account,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  } catch (err) {
    throw new SignatureError("wallet refused to sign perps order", err);
  }

  const intent = await rest.submitIntent(
    {
      chainId,
      marketId: args.marketId,
      trader: account.address,
      side: args.side,
      sizeUsdc: args.sizeUsdc,
      leverage: args.leverage,
      orderType,
      priceE18: args.priceE18,
      reduceOnly: args.reduceOnly ?? false,
      postOnly: args.postOnly ?? false,
      nonce,
      deadline,
      signature,
    },
    { signal: args.signal },
  );

  return {
    intentId: intent.intentId,
    digest: intent.digest as Hex,
    status: intent.status,
    typedData: intent.typedData,
    quote,
    signature,
  };
}
