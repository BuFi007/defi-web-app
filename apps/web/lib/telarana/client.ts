/**
 * Thin fetch wrapper around the Hono fx-telarana routes. Centralizes:
 *
 * - API base resolution (NEXT_PUBLIC_API_URL → NEXT_PUBLIC_BUFI_API_URL → localhost).
 * - bigint serialization in request bodies (JSON has no native bigint).
 * - Optional wallet-session headers for routes that require auth.
 *
 * Endpoints mirror apps/api/src/routes/fx-telarana.ts.
 */
import type { Address, Hex } from "viem";

import { resilientFetch } from "@/lib/api-client";

const DEFAULT_API_URL = "http://localhost:3002";

export function telaranaApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL ??
    DEFAULT_API_URL
  );
}

export function telaranaApiUrl(path: string): string {
  return new URL(path, telaranaApiBaseUrl()).toString();
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export interface WalletSessionHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-Signature": Hex;
  "X-Wallet-TypedData"?: string;
  "X-Wallet-Message"?: string;
}

export interface TelaranaFetchOptions {
  session?: WalletSessionHeaders;
  signal?: AbortSignal;
}

async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T & { error?: string; code?: string }) : (null as unknown as T);
  if (!response.ok) {
    const err = (body as { error?: string })?.error ?? `HTTP ${response.status}`;
    const code = (body as { code?: string })?.code;
    const error = new Error(err) as Error & { status: number; code?: string };
    error.status = response.status;
    if (code) error.code = code;
    throw error;
  }
  return body;
}

export async function telaranaGet<T>(path: string, opts: TelaranaFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.session) Object.assign(headers, opts.session);
  // TODO: wire `onUnauthorized` to a session re-sign helper once one is
  // exposed by lib/telarana/session.ts (today it only reads cached proofs;
  // re-signing requires the wallet adapter which lives in the React tree).
  const response = await resilientFetch(telaranaApiUrl(path), {
    method: "GET",
    headers,
    signal: opts.signal,
  });
  return unwrap<T>(response);
}

export async function telaranaPost<T>(
  path: string,
  body: unknown,
  opts: TelaranaFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (opts.session) Object.assign(headers, opts.session);
  // TODO: see telaranaGet — `onUnauthorized` would re-sign the typed-data
  // session here, but the re-sign primitive currently lives in the wallet
  // hook tree. Caller still parses the 401 via unwrap() for now.
  const response = await resilientFetch(telaranaApiUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(body, bigintReplacer),
    signal: opts.signal,
  });
  return unwrap<T>(response);
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

async function telaranaGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: TelaranaFetchOptions = {},
): Promise<T> {
  const response = await resilientFetch(telaranaApiUrl("/graph"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }, bigintReplacer),
    signal: opts.signal,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as GraphqlResponse<T>) : {};
  if (!response.ok) {
    throw new Error(`Envio GraphQL request failed: ${response.status}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? "Envio GraphQL returned errors");
  }
  if (!body.data) {
    throw new Error("Envio GraphQL response missing data");
  }
  return body.data;
}

// ────────────────────── response shapes (serialized) ───────────────────────

export interface TelaranaMarketSerialized {
  id: Hex;
  hubChainId: 43113 | 5042002;
  hubName: "fuji" | "arc";
  isLive: boolean;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: string;
  state?: {
    totalSupplyAssets: string;
    totalSupplyShares: string;
    totalBorrowAssets: string;
    totalBorrowShares: string;
    lastUpdate: string;
    fee: string;
  };
}

export interface TelaranaPositionSerialized {
  id: string;
  marketId: Hex;
  hubChainId: 43113 | 5042002;
  account: Address;
  supplyShares: string;
  borrowShares: string;
  collateral: string;
  supplyAssets: string;
  borrowAssets: string;
  collateralPriceE36: string | null;
  oraclePublishedAt: string | null;
  healthFactorE18: string | null;
  liquidatable: boolean;
}

export interface EnvioDailyMarketSnapshot {
  id: string;
  marketId: string;
  date: string;
  chainId: number;
  totalSupply: string;
  totalBorrow: string;
  turboFeeAmount: string;
  turboProtocolShare: string;
  turboLpShare: string;
  turboInsuranceShare: string;
  yieldClaimed: string;
  insurancePayouts: string;
  morphoBaseApy: string;
  feeBoostApy: string;
  compositeApy: string;
  annualizedFeeApy: string;
}

export interface TelaranaIntentDoc {
  id: string;
  kind:
    | "Supply"
    | "Borrow"
    | "Repay"
    | "Withdraw"
    | "SupplyCollateral"
    | "WithdrawCollateral";
  createdAt: string;
  updatedAt: string;
  status: "unsigned" | "verified";
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, string>;
  };
}

// ────────────────────── typed entrypoints ──────────────────────────────────

export function fetchMarkets(opts?: TelaranaFetchOptions) {
  return telaranaGet<{ markets: TelaranaMarketSerialized[] }>("/fx-telarana/markets", opts);
}

export function fetchPositions(address: Address, opts?: TelaranaFetchOptions) {
  return telaranaGet<{
    address: Address;
    source: string;
    positions: TelaranaPositionSerialized[];
  }>(`/fx-telarana/positions/${address}`, opts);
}

export function fetchYieldSnapshots(args: {
  marketIds?: string[];
  limit?: number;
  signal?: AbortSignal;
}) {
  const marketIds = args.marketIds?.filter(Boolean) ?? [];
  const fields = `
    id
    marketId
    date
    chainId
    totalSupply
    totalBorrow
    turboFeeAmount
    turboProtocolShare
    turboLpShare
    turboInsuranceShare
    yieldClaimed
    insurancePayouts
    morphoBaseApy
    feeBoostApy
    compositeApy
    annualizedFeeApy
  `;
  const query = marketIds.length
    ? `query YieldSnapshots($marketIds: [String!], $limit: Int!) {
        DailyMarketSnapshot(
          where: {marketId: {_in: $marketIds}}
          order_by: {date: desc}
          limit: $limit
        ) { ${fields} }
      }`
    : `query YieldSnapshots($limit: Int!) {
        DailyMarketSnapshot(order_by: {date: desc}, limit: $limit) { ${fields} }
      }`;

  return telaranaGraphql<{ DailyMarketSnapshot: EnvioDailyMarketSnapshot[] }>(
    query,
    marketIds.length ? { marketIds, limit: args.limit ?? 500 } : { limit: args.limit ?? 500 },
    { signal: args.signal },
  ).then((data) => ({ snapshots: data.DailyMarketSnapshot ?? [] }));
}

export interface BorrowQuoteBody {
  loanToken: Address;
  collateralToken: Address;
  hubChainId: 43113 | 5042002;
  collateral: bigint;
  borrowAmount: bigint;
  account?: Address;
}

export interface BorrowQuoteResponseSerialized {
  market: TelaranaMarketSerialized;
  collateral: string;
  borrowAmount: string;
  borrowAssetsAfter: string;
  healthFactorE18: string;
  liquidatable: boolean;
  maxBorrowAssets: string;
  collateralInput: string;
  existingPosition: TelaranaPositionSerialized | null;
  oracle: { midE18: string; publishedAt: string };
}

export function postBorrowQuote(body: BorrowQuoteBody, opts?: TelaranaFetchOptions) {
  return telaranaPost<BorrowQuoteResponseSerialized>("/fx-telarana/borrow/quote", body, opts);
}

export function fetchIntentNonce(args: {
  hubChainId: 43113 | 5042002;
  action: "Supply" | "Borrow" | "Repay" | "Withdraw" | "SupplyCollateral" | "WithdrawCollateral";
  account: Address;
}) {
  return telaranaGet<{ nextNonce: string }>(
    `/fx-telarana/intents/nonce/${args.hubChainId}/${args.action}/${args.account}`,
  );
}

export interface CreateIntentArgs {
  path: "supply" | "borrow" | "repay" | "withdraw" | "collateral/supply" | "collateral/withdraw";
  body: Record<string, unknown>;
  session: WalletSessionHeaders;
}

export function createIntent({ path, body, session }: CreateIntentArgs) {
  return telaranaPost<TelaranaIntentDoc>(`/fx-telarana/${path}/intents`, body, { session });
}

export function submitIntentSignature(args: {
  path: "supply" | "borrow" | "repay" | "withdraw" | "collateral/supply" | "collateral/withdraw";
  id: string;
  signer: Address;
  signature: Hex;
}) {
  return telaranaPost<TelaranaIntentDoc>(
    `/fx-telarana/${args.path}/intents/${args.id}/signature`,
    { signer: args.signer, signature: args.signature },
  );
}
