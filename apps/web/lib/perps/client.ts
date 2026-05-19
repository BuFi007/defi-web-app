/**
 * Thin fetch wrapper around the live /perps/* routes served by apps/api.
 *
 * Reuses the wallet-session header pattern already implemented for the
 * replacement agent (apps/web/lib/perps/replacement-agent.ts) so the same
 * cached EIP-712 session signs reads of private endpoints (positions,
 * intents, replacement events) without re-prompting the wallet.
 */

import type { Hex } from "viem";

import { resilientFetch } from "@/lib/api-client";

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
  /**
   * Realized PnL in USDC decimal-string units (e.g. "12.345678", signed).
   * Present on settlements that map to a `PositionDecreased` event; absent
   * on opening fills. Aggregated server-side from the indexer's
   * `perps_position_event.pnl` field — see `apps/api/src/routes/perps.ts`
   * for the join.
   */
  realizedPnlUsdc?: string;
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

/**
 * Read-endpoint 401 contract: perps wallet-session proofs are minted via a
 * typed-data signature in the React tree (see `replacement-agent.ts`). When
 * a read endpoint returns 401 (proof expired), the only recovery is for the
 * user to re-sign — which we can't do from this module-level client without
 * a wallet adapter. So we let 401s bubble; the calling hook is responsible
 * for prompting a fresh sign and retrying. We DO opt-in to retry/backoff
 * for 5xx / network errors on every read.
 *
 * Write endpoints that carry a user-signed intent (`submitPerpsIntent`) MUST
 * NOT auto-refresh on 401 either — a fresh session would invalidate the
 * already-signed payload's deadline assumptions. Idempotency-Key is still
 * attached (via `resilientFetch`) so the API can dedupe the inevitable
 * timeout-retry case safely.
 */

export async function fetchPerpsMarkets(args: {
  chainId: number;
  signal?: AbortSignal;
}): Promise<PerpsMarketDto[]> {
  const path = "/perps/markets";
  const res = await resilientFetch(bufxApiUrl(path, { chainId: args.chainId }), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ markets: PerpsMarketDto[] }>(res, path);
  return body.markets;
}

// 24h stats: see lib/perps/use-market-stats.ts. It predates this file
// and is already consumed by panels.tsx. The DTO + hook live there.

export interface PerpsCandleDto {
  /** Open time, unix seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Pyth Benchmarks volume proxy. Treat as relative, not native units. */
  v: number;
}

export interface PerpsCandlesResponseDto {
  sym: string;
  tf: string;
  source: "pyth-benchmarks" | "empty";
  candles: PerpsCandleDto[];
}

/**
 * Historical OHLCV from `/perps/markets/:sym/candles`. Pyth Benchmarks via
 * the TradingView UDF shim. Use the returned `source` to detect the
 * empty-fallback case (unmapped symbol or 404 upstream).
 */
export async function fetchPerpsCandles(args: {
  sym: string;
  tf?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PerpsCandlesResponseDto> {
  const path = `/perps/markets/${encodeURIComponent(args.sym)}/candles`;
  const res = await resilientFetch(
    bufxApiUrl(path, { tf: args.tf, limit: args.limit }),
    { headers: { accept: "application/json" }, signal: args.signal },
  );
  return jsonOrThrow<PerpsCandlesResponseDto>(res, path);
}

export interface PerpsOrderbookLevelDto {
  /** 1e18-scaled price. */
  priceE18: string;
  /** 1e18-scaled aggregated remaining size at this level. */
  sizeE18: string;
  /** How many intents are grouped into this bucket. */
  count: number;
}

export interface PerpsOrderbookDto {
  marketId: string;
  depth: number;
  bids: PerpsOrderbookLevelDto[];
  asks: PerpsOrderbookLevelDto[];
  /** Total pending intents on this market (pre-bucketing, includes market orders). */
  totalPending: number;
}

/**
 * Pending-intents view from `/perps/intents/pending`. This is a
 * matcher-style view (price-time priority on signed intents), not a true
 * CLOB — but it's the canonical "orderbook" surface the UI renders.
 */
export async function fetchPerpsOrderbook(args: {
  marketId: string;
  depth?: number;
  signal?: AbortSignal;
}): Promise<PerpsOrderbookDto> {
  const path = "/perps/intents/pending";
  const res = await resilientFetch(
    bufxApiUrl(path, { marketId: args.marketId, depth: args.depth }),
    { headers: { accept: "application/json" }, signal: args.signal },
  );
  return jsonOrThrow<PerpsOrderbookDto>(res, path);
}

export async function fetchPerpsQuote(args: {
  request: PerpsQuoteRequestBody;
  signal?: AbortSignal;
}): Promise<PerpsQuoteDto> {
  const path = "/perps/quote";
  const res = await resilientFetch(bufxApiUrl(path), {
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
  // No `onUnauthorized`: 401 here means the user-signed payload is stale and
  // must be re-signed by the caller. Retry/backoff on 5xx is still useful
  // because Idempotency-Key dedupes the write at the API.
  const res = await resilientFetch(bufxApiUrl(path), {
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
  const res = await resilientFetch(bufxApiUrl(path), {
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
  // Read endpoint — 401 bubbles so the wallet-hook tree can re-sign and retry.
  const res = await resilientFetch(bufxApiUrl(path), {
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
  const res = await resilientFetch(bufxApiUrl(path), {
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
  const res = await resilientFetch(
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
  const res = await resilientFetch(bufxApiUrl(path, { chainId: args.chainId }), {
    headers: { accept: "application/json" },
    signal: args.signal,
  });
  const body = await jsonOrThrow<{ candidates: unknown[] }>(res, path);
  return body.candidates;
}
