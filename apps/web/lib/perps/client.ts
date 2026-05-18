/**
 * Thin fetch wrapper around the live /perps/* routes served by apps/api.
 *
 * Reuses the wallet-session header pattern already implemented for the
 * replacement agent (apps/web/lib/perps/replacement-agent.ts) so the same
 * cached EIP-712 session signs reads of private endpoints (positions,
 * intents, replacement events) without re-prompting the wallet.
 */

import type { Hex } from "viem";

import {
  bufxApiUrl,
  walletSessionHeaders,
  type WalletSessionHeaders,
  type WalletSessionProof,
} from "./replacement-agent";

export type PerpsSide = "long" | "short";
export type PerpsOrderKind = "limit" | "market";
export type PerpsIntentStatus =
  | "pending"
  | "partially_filled"
  | "filled"
  | "rejected"
  | "expired";

export interface PerpsMarketDto {
  marketId: string;
  symbol: string;
  baseAsset: `0x${string}`;
  quoteAsset: `0x${string}`;
  source: "pyth" | "onchain" | "uniswap-v4" | "chainlink" | "internal";
  chainId: number;
  enabled: boolean;
}

export interface PerpsQuoteRequestBody {
  chainId: number;
  marketId: string;
  trader?: `0x${string}`;
  side: PerpsSide;
  /** Decimal USDC string (e.g. "100.000000"). */
  sizeUsdc: string;
  /** Optional contract-native signed delta (overrides sizeUsdc when set). */
  sizeDelta?: string;
  leverage: number;
}

export interface PerpsQuoteDto {
  marketId: string;
  side: PerpsSide;
  sizeUsdc: string;
  leverage: number;
  fee: string;
  markPrice: string;
  requiredMargin: string;
  maxLeverage: number;
  oracleStaleSeconds: number;
  oracle: {
    source: "pyth" | "onchain";
    timestamp: number;
    maxStaleSeconds: number;
  };
}

export interface PerpsIntentRequestBody extends PerpsQuoteRequestBody {
  trader: `0x${string}`;
  deadline: number;
  nonce: string;
  orderType: PerpsOrderKind;
  /** Limit price as 1e18 fixed-point. Zero for market orders. */
  priceE18: string;
  limitPrice?: string;
  reduceOnly: boolean;
  postOnly: boolean;
  signature: Hex;
}

export interface PerpsIntentResponseDto {
  intentId: string;
  digest: Hex;
  status: "accepted" | "rejected";
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

export interface PerpsIntentDto {
  intentId: string;
  replacementOf?: string;
  chainId: number;
  trader: `0x${string}`;
  marketId: string;
  side: PerpsSide;
  sizeUsdc: string;
  sizeDelta: string;
  filledSizeDelta: string;
  remainingSizeDelta: string;
  leverage: number;
  orderType: PerpsOrderKind;
  priceE18: string;
  limitPrice?: string;
  reduceOnly: boolean;
  postOnly: boolean;
  flags: number;
  digest: Hex;
  signature: Hex;
  /** Backend serialises bigint as string via jsonSafe(). */
  nonce: string;
  deadline: number;
  status: PerpsIntentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PerpsPositionDto {
  marketId: string;
  side: PerpsSide;
  sizeUsdc: string;
  leverage: number;
  fee: string;
  markPrice: string;
  requiredMargin: string;
  /** Optional fields that may appear once the service starts emitting state. */
  entryPriceE18?: string;
  liqPriceE18?: string;
  unrealizedPnlUsdc?: string;
}

export interface PerpsTradeDto {
  marketId: string;
  side: PerpsSide;
  sizeUsdc: string;
  priceE18: string;
  fillSizeE18: string;
  fillPriceE18: string;
  txHash: Hex;
  blockTimestamp: number;
}

export interface PerpsFundingDto {
  marketId: string;
  /** Funding rate accrued in the period, signed bps per second. */
  fundingRateBpsPerSecond: number;
  periodStart: number;
  periodEnd: number;
}

async function jsonOrThrow<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 240);
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      // fall through with raw text
    }
    throw new Error(`BUFX API ${path} -> ${res.status}: ${message}`);
  }
  return (await res.json()) as T;
}

export async function fetchPerpsMarkets(args: {
  chainId: number;
  signal?: AbortSignal;
}): Promise<PerpsMarketDto[]> {
  const path = "/perps/markets";
  const res = await fetch(bufxApiUrl(path, { chainId: args.chainId }), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ markets: PerpsMarketDto[] }>(res, path);
  return body.markets;
}

export async function fetchPerpsQuote(args: {
  request: PerpsQuoteRequestBody;
  signal?: AbortSignal;
}): Promise<PerpsQuoteDto> {
  const path = "/perps/quote";
  const res = await fetch(bufxApiUrl(path), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(args.request),
    signal: args.signal,
  });
  return jsonOrThrow<PerpsQuoteDto>(res, path);
}

export async function submitPerpsIntent(args: {
  request: PerpsIntentRequestBody;
  proof: WalletSessionProof;
  signal?: AbortSignal;
}): Promise<PerpsIntentResponseDto> {
  const path = "/perps/intents";
  const headers: WalletSessionHeaders = walletSessionHeaders(args.proof);
  const res = await fetch(bufxApiUrl(path), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(args.request),
    signal: args.signal,
  });
  return jsonOrThrow<PerpsIntentResponseDto>(res, path);
}

export async function fetchPerpsIntent(args: {
  intentId: string;
  signal?: AbortSignal;
}): Promise<PerpsIntentDto> {
  const path = `/perps/intents/${args.intentId}`;
  const res = await fetch(bufxApiUrl(path), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ intent: PerpsIntentDto }>(res, path);
  return body.intent;
}

export async function fetchPerpsPositions(args: {
  address: `0x${string}`;
  proof: WalletSessionProof;
  signal?: AbortSignal;
}): Promise<PerpsPositionDto[]> {
  const path = `/perps/positions/${args.address}`;
  const res = await fetch(bufxApiUrl(path), {
    headers: { accept: "application/json", ...walletSessionHeaders(args.proof) },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ address: string; positions: PerpsPositionDto[] }>(
    res,
    path,
  );
  return body.positions;
}

export async function fetchPerpsTrades(args: {
  address: `0x${string}`;
  signal?: AbortSignal;
}): Promise<PerpsTradeDto[]> {
  const path = `/perps/trades/${args.address}`;
  const res = await fetch(bufxApiUrl(path), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ address: string; trades: PerpsTradeDto[] }>(
    res,
    path,
  );
  return body.trades;
}

export async function fetchPerpsFunding(args: {
  chainId: number;
  marketId?: string;
  signal?: AbortSignal;
}): Promise<PerpsFundingDto[]> {
  const path = "/perps/funding";
  const res = await fetch(
    bufxApiUrl(path, { chainId: args.chainId, marketId: args.marketId }),
    { headers: { accept: "application/json" }, signal: args.signal },
  );
  const body = await jsonOrThrow<{ funding: PerpsFundingDto[] }>(res, path);
  return body.funding;
}

export async function fetchPerpsLiquidationCandidates(args: {
  chainId: number;
  signal?: AbortSignal;
}): Promise<unknown[]> {
  const path = "/perps/liquidations/candidates";
  const res = await fetch(bufxApiUrl(path, { chainId: args.chainId }), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ candidates: unknown[] }>(res, path);
  return body.candidates;
}
