// Subpath-import the channel constant + payload type only. Pulling from the
// package root drags ioredis (and its `net`/`dns`/`tls` deps) into every
// client bundle that transitively touches @bufi/perps. The `channels` and
// `types` subpath exports stay pure constants / types.
import { PERPS_INTENT_INSERTED_CHANNEL } from "@bufi/realtime/channels";
import type { PerpsIntentInsertedMessage } from "@bufi/realtime/types";
import type { MarketRegistryEntry, PerpIntent, PerpQuote } from "@bufi/shared-types";
import type { Hex } from "viem";

import {
  perpsIntentRequest,
  perpsQuoteRequest,
  perpsReplacementPrepareRequest,
  perpsReplacementSubmitRequest,
  type PerpsIntentRequest,
  type PerpsIntentResponse,
  type PerpsQuoteRequest,
  type PerpsQuoteResponse,
  type PerpsReplacementPrepareRequest,
  type PerpsReplacementPrepareResponse,
  type PerpsReplacementSubmitRequest,
} from "./schemas";
import {
  buildPerpsOrderTypedData,
  hashPerpsOrder,
  orderFlags,
  signedSizeDelta,
  verifyPerpsOrderSignature,
  type PerpsOrderTypedDataInput,
} from "./typed-data";

export interface PerpsQuoteReader {
  quoteFee(req: PerpsQuoteRequest): Promise<{
    fee: string;
    markPrice: string;
    requiredMargin: string;
    oracleTimestamp: number;
    oracleStaleSeconds: number;
    maxLeverage: number;
  }>;
}

export interface PerpsNonceReader {
  isNonceUsed(chainId: number, trader: string, nonce: bigint): Promise<boolean>;
}

/**
 * Indexed open-position row (one per (chainId, marketId, trader)).
 * Mirrors `perps_position` rows produced by ponder, plus an optional mark
 * price snapshot resolved at query time.
 *
 * Backend is the source of truth for size/entry/margin; mark price is
 * a best-effort live read used to compute unrealized PnL on the wire.
 */
export interface PerpsIndexedPosition {
  chainId: number;
  marketId: string;
  trader: string;
  /** Signed size; positive = long, negative = short, zero = closed. */
  sizeE18: string | bigint;
  entryPriceE18: string | bigint;
  marginReserved: string | bigint;
  lastFundingVersion?: string | bigint;
  isOpen: boolean;
  updatedAt?: string | bigint;
  updatedBlockNumber?: string | bigint;
  updatedTxHash?: string;
  /** Optional live mark snapshot. */
  markPriceE18?: string | bigint;
  /** Optional pre-computed unrealized PnL in USDC atomic units. */
  unrealizedPnlUsdc?: string | bigint;
}

export interface PerpsPositionReader {
  listOpenPositions(filter: {
    chainId: number;
    trader: string;
  }): Promise<PerpsIndexedPosition[]>;
}

export interface PerpsIntentStore {
  put(intent: PerpIntent): Promise<void>;
  get(intentId: string): Promise<PerpIntent | null>;
  getByTraderNonce(trader: string, nonce: bigint): Promise<PerpIntent | null>;
  list(filter?: { trader?: string; status?: PerpIntent["status"] }): Promise<PerpIntent[]>;
  updateStatus(intentId: string, status: PerpIntent["status"]): Promise<PerpIntent>;
  recordFill(intentId: string, fillSizeDelta: bigint): Promise<PerpIntent>;
}

/**
 * Cross-process notification hook fired after a fresh intent lands in the
 * store. The matcher subscribes to the corresponding Redis channel and uses
 * the notify to schedule an early match attempt (~100ms vs ~30s poll).
 *
 * Optional + fire-and-forget: the service awaits it (so errors surface in
 * logs) but never lets a publish failure bubble out of `createIntent`. A
 * dropped notify just means the matcher waits for its next poll tick.
 *
 * Injected from the caller (apps/api wraps `@bufi/realtime`'s
 * `publishChannel`) so `@bufi/perps` doesn't gain a direct Redis dep.
 */
export type PerpsRealtimePublish = (args: {
  channel: string;
  payload: unknown;
}) => Promise<void>;

export interface CreatePerpsServiceOptions {
  markets?: MarketRegistryEntry[];
  quoteReader?: PerpsQuoteReader;
  nonceReader?: PerpsNonceReader;
  positionReader?: PerpsPositionReader;
  intentStore?: PerpsIntentStore;
  maxOracleStaleSeconds?: number;
  /** Chain to default `listPositions` to when caller doesn't specify. */
  defaultChainId?: number;
  now?: () => number;
  /**
   * Optional Wave H1 hook — fires once per persisted intent on the
   * `perps:intent:inserted` channel. The matcher subscribes and runs an
   * early match attempt; without it the matcher waits for the next poll
   * tick (~30s by default).
   */
  realtimePublish?: PerpsRealtimePublish;
}

export interface PerpsService {
  listMarkets(chainId: number): Promise<MarketRegistryEntry[]>;
  getMarket(chainId: number, marketId: string): Promise<MarketRegistryEntry | null>;
  quote(req: PerpsQuoteRequest): Promise<PerpsQuoteResponse>;
  createIntent(req: PerpsIntentRequest): Promise<PerpsIntentResponse>;
  prepareReplacementIntent(req: PerpsReplacementPrepareRequest): Promise<PerpsReplacementPrepareResponse>;
  createReplacementIntent(req: PerpsReplacementSubmitRequest): Promise<
    PerpsIntentResponse & {
      originalIntentId: string;
      replacementOf: string;
      remainingSizeDelta: string;
    }
  >;
  getIntent(intentId: string): Promise<PerpIntent | null>;
  listPositions(trader: string): Promise<PerpQuote[]>;
  funding(chainId: number, marketId?: string): Promise<Array<{ at: number; bps: number }>>;
  liquidationCandidates(chainId: number): Promise<PerpIntent[]>;
}

export function createPerpsService(opts: CreatePerpsServiceOptions = {}): PerpsService {
  const markets = opts.markets ?? [];
  const store = opts.intentStore ?? createInMemoryPerpsIntentStore();
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const maxOracleStaleSeconds = opts.maxOracleStaleSeconds ?? 30;
  // Default chain for `listPositions(trader)` reads; falls back to the
  // first registered market so single-chain deploys do not need extra wiring.
  const defaultChainId = opts.defaultChainId ?? markets[0]?.chainId ?? 5042002;

  const acceptSignedIntent = async (
    req: PerpsIntentRequest,
    meta: { replacementOf?: string } = {},
  ): Promise<PerpsIntentResponse> => {
    const parsed = perpsIntentRequest.parse(req);
    if (parsed.deadline <= now()) throw new Error("deadline expired");
    const market = markets.find((m) => m.chainId === parsed.chainId && m.marketId === parsed.marketId);
    if (!market || !market.enabled) {
      throw new Error(`market not enabled: ${parsed.marketId}`);
    }
    requireContractSizeDelta(parsed.sizeDelta);
    const validSig = await verifyPerpsOrderSignature(parsed);
    if (!validSig) throw new Error("invalid perps order signature");
    const digest = hashPerpsOrder(parsed);
    const nonce = BigInt(parsed.nonce);
    const existingByNonce = await store.getByTraderNonce(parsed.trader, nonce);
    if (existingByNonce) {
      if (existingByNonce.intentId !== digest) {
        throw new Error(`nonce already used by ${parsed.trader}: ${parsed.nonce}`);
      }
      if (meta.replacementOf && existingByNonce.replacementOf !== meta.replacementOf) {
        throw new Error(`nonce already used by ${parsed.trader}: ${parsed.nonce}`);
      }
      return {
        intentId: existingByNonce.intentId,
        digest,
        status: "accepted",
        typedData: serializeTypedData(buildPerpsOrderTypedData(parsed)),
      };
    }
    if (opts.nonceReader && (await opts.nonceReader.isNonceUsed(parsed.chainId, parsed.trader, nonce))) {
      throw new Error(`nonce already used on-chain by ${parsed.trader}: ${parsed.nonce}`);
    }
    const sizeDelta = signedSizeDelta(parsed).toString();
    const createdAt = now();
    const intent: PerpIntent = {
      intentId: digest,
      chainId: parsed.chainId,
      trader: parsed.trader as PerpIntent["trader"],
      marketId: parsed.marketId,
      side: parsed.side,
      sizeUsdc: parsed.sizeUsdc,
      sizeDelta,
      filledSizeDelta: "0",
      remainingSizeDelta: sizeDelta,
      leverage: parsed.leverage,
      orderType: parsed.orderType,
      priceE18: parsed.priceE18 ?? parsed.limitPrice ?? "0",
      limitPrice: parsed.limitPrice,
      reduceOnly: parsed.reduceOnly,
      postOnly: parsed.postOnly,
      flags: orderFlags(parsed),
      digest,
      signature: parsed.signature as Hex,
      nonce,
      deadline: parsed.deadline,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    };
    if (meta.replacementOf) {
      intent.replacementOf = meta.replacementOf;
    }
    await store.put(intent);
    // Fire-and-forget notify so the matcher can pick this up sub-second
    // instead of waiting for its next poll tick. We deliberately await
    // (so the publish is sequenced after store.put) but the publish
    // surface itself never throws — see PerpsRealtimePublish docs.
    if (opts.realtimePublish) {
      await opts.realtimePublish({
        channel: PERPS_INTENT_INSERTED_CHANNEL,
        payload: {
          intentId: intent.intentId,
          marketId: intent.marketId,
          chainId: intent.chainId,
          side: intent.side,
          insertedAt: Date.now(),
        } satisfies PerpsIntentInsertedMessage,
      });
    }
    return {
      intentId: intent.intentId,
      digest,
      status: "accepted",
      typedData: serializeTypedData(buildPerpsOrderTypedData(parsed)),
    };
  };

  const prepareReplacementOrder = async (
    req: PerpsReplacementPrepareRequest,
  ): Promise<{ original: PerpIntent; order: PerpsOrderTypedDataInput; digest: Hex }> => {
    const parsed = perpsReplacementPrepareRequest.parse(req);
    if (parsed.deadline <= now()) throw new Error("deadline expired");
    const original = await store.get(parsed.originalIntentId);
    if (!original) throw new Error(`perps intent not found: ${parsed.originalIntentId}`);
    if (original.status !== "partially_filled") {
      throw new Error(`perps intent ${parsed.originalIntentId} is not partially_filled`);
    }
    const remaining = BigInt(original.remainingSizeDelta);
    if (remaining === 0n) {
      throw new Error(`perps intent ${parsed.originalIntentId} has no residual quantity`);
    }
    const market = markets.find((m) => m.chainId === original.chainId && m.marketId === original.marketId);
    if (!market || !market.enabled) {
      throw new Error(`market not enabled: ${original.marketId}`);
    }

    const orderType = parsed.orderType ?? original.orderType;
    const priceE18 = replacementPriceE18(parsed, original, orderType);
    const order: PerpsOrderTypedDataInput = {
      chainId: original.chainId,
      marketId: original.marketId,
      trader: original.trader,
      side: sideFromSignedSizeDelta(remaining),
      sizeUsdc: parsed.sizeUsdc ?? original.sizeUsdc,
      sizeDelta: original.remainingSizeDelta,
      leverage: original.leverage,
      orderType,
      limitPrice: replacementLimitPrice(parsed, original, orderType, priceE18),
      priceE18,
      reduceOnly: parsed.reduceOnly ?? original.reduceOnly,
      postOnly: parsed.postOnly ?? original.postOnly,
      nonce: parsed.nonce,
      deadline: parsed.deadline,
    };
    const digest = hashPerpsOrder(order);
    const blockingReplacement = await findBlockingReplacement(store, original.intentId, now());
    if (blockingReplacement && blockingReplacement.intentId !== digest) {
      throw new Error(
        `replacement already exists for ${original.intentId}: ${blockingReplacement.intentId}`,
      );
    }
    const nonce = BigInt(parsed.nonce);
    const existingByNonce = await store.getByTraderNonce(original.trader, nonce);
    if (existingByNonce && existingByNonce.intentId !== digest) {
      throw new Error(`nonce already used by ${original.trader}: ${parsed.nonce}`);
    }
    if (existingByNonce && existingByNonce.replacementOf !== original.intentId) {
      throw new Error(`nonce already used by ${original.trader}: ${parsed.nonce}`);
    }
    if (
      opts.nonceReader &&
      !existingByNonce &&
      (await opts.nonceReader.isNonceUsed(original.chainId, original.trader, nonce))
    ) {
      throw new Error(`nonce already used on-chain by ${original.trader}: ${parsed.nonce}`);
    }
    return { original, order, digest };
  };

  return {
    async listMarkets(chainId) {
      return markets.filter((m) => m.chainId === chainId);
    },
    async getMarket(chainId, marketId) {
      return markets.find((m) => m.chainId === chainId && m.marketId === marketId) ?? null;
    },
    async quote(req) {
      const parsed = perpsQuoteRequest.parse(req);
      const market = markets.find((m) => m.chainId === parsed.chainId && m.marketId === parsed.marketId);
      if (!market || !market.enabled) {
        throw new Error(`market not enabled: ${parsed.marketId}`);
      }
      requireContractSizeDelta(parsed.sizeDelta);
      if (!opts.quoteReader) {
        throw new Error("perps quote reader is not configured; deploy Phase B-E contracts or set CONTRACT_ADDRESSES_JSON");
      }
      const quote = await opts.quoteReader.quoteFee(parsed);
      if (quote.oracleStaleSeconds > maxOracleStaleSeconds) {
        throw new Error(
          `oracle stale: age=${quote.oracleStaleSeconds}s max=${maxOracleStaleSeconds}s`,
        );
      }
      return {
        ...parsed,
        fee: quote.fee,
        markPrice: quote.markPrice,
        requiredMargin: quote.requiredMargin,
        maxLeverage: quote.maxLeverage,
        oracleStaleSeconds: quote.oracleStaleSeconds,
        oracle: {
          source: "onchain",
          timestamp: quote.oracleTimestamp,
          maxStaleSeconds: maxOracleStaleSeconds,
        },
      };
    },
    async createIntent(req) {
      return acceptSignedIntent(req);
    },
    async prepareReplacementIntent(req) {
      const prepared = await prepareReplacementOrder(req);
      return {
        originalIntentId: prepared.original.intentId,
        replacementOf: prepared.original.intentId,
        remainingSizeDelta: prepared.original.remainingSizeDelta,
        digest: prepared.digest,
        typedData: serializeTypedData(buildPerpsOrderTypedData(prepared.order)),
      };
    },
    async createReplacementIntent(req) {
      const parsed = perpsReplacementSubmitRequest.parse(req);
      const prepared = await prepareReplacementOrder(parsed);
      const accepted = await acceptSignedIntent(
        {
          ...prepared.order,
          postOnly: prepared.order.postOnly ?? false,
          signature: parsed.signature,
        },
        { replacementOf: prepared.original.intentId },
      );
      return {
        ...accepted,
        originalIntentId: prepared.original.intentId,
        replacementOf: prepared.original.intentId,
        remainingSizeDelta: prepared.original.remainingSizeDelta,
      };
    },
    async getIntent(intentId) {
      return store.get(intentId);
    },
    async listPositions(trader) {
      if (!opts.positionReader) return [];
      const rows = await opts.positionReader.listOpenPositions({
        chainId: defaultChainId,
        trader,
      });
      return rows
        .filter((row) => row.isOpen && BigInt(row.sizeE18 ?? 0n) !== 0n)
        .map((row) => mapIndexedPositionToPerpQuote(row, markets, maxOracleStaleSeconds, now()));
    },
    async funding() {
      return [];
    },
    async liquidationCandidates() {
      return [];
    },
  };
}

function requireContractSizeDelta(sizeDelta: string | undefined): void {
  if (sizeDelta === undefined) {
    throw new Error("sizeDelta is required for live perps; pass contract-native sizeDeltaE18");
  }
}

function replacementPriceE18(
  req: PerpsReplacementPrepareRequest,
  original: PerpIntent,
  orderType: "limit" | "market",
): string {
  if (req.priceE18 !== undefined) return req.priceE18;
  if (req.limitPrice !== undefined) return req.limitPrice;
  if (orderType === original.orderType) return original.priceE18;
  return orderType === "market" ? "0" : original.priceE18;
}

function replacementLimitPrice(
  req: PerpsReplacementPrepareRequest,
  original: PerpIntent,
  orderType: "limit" | "market",
  priceE18: string,
): string | undefined {
  if (orderType !== "limit") return req.limitPrice;
  return req.limitPrice ?? req.priceE18 ?? original.limitPrice ?? priceE18;
}

function sideFromSignedSizeDelta(sizeDelta: bigint): "long" | "short" {
  return sizeDelta > 0n ? "long" : "short";
}

async function findBlockingReplacement(
  store: PerpsIntentStore,
  originalIntentId: string,
  now: number,
): Promise<PerpIntent | null> {
  const replacements = await store.list();
  return (
    replacements.find(
      (intent) =>
        intent.replacementOf === originalIntentId &&
        (intent.status === "filled" ||
          intent.status === "partially_filled" ||
          (intent.status === "pending" && intent.deadline > now)),
    ) ?? null
  );
}

export function createInMemoryPerpsIntentStore(): PerpsIntentStore {
  const map = new Map<string, PerpIntent>();
  const nonceMap = new Map<string, PerpIntent>();
  return {
    async put(intent) {
      const existing = map.get(intent.intentId);
      if (existing) return;
      const key = traderNonceKey(intent.trader, intent.nonce);
      const existingByNonce = nonceMap.get(key);
      if (existingByNonce && existingByNonce.intentId !== intent.intentId) {
        throw new Error(`nonce already used by ${intent.trader}: ${intent.nonce.toString()}`);
      }
      map.set(intent.intentId, intent);
      nonceMap.set(key, intent);
    },
    async get(intentId) {
      return map.get(intentId) ?? null;
    },
    async getByTraderNonce(trader, nonce) {
      return nonceMap.get(traderNonceKey(trader, nonce)) ?? null;
    },
    async list(filter) {
      return [...map.values()].filter((intent) => {
        if (filter?.trader && intent.trader.toLowerCase() !== filter.trader.toLowerCase()) return false;
        if (filter?.status && intent.status !== filter.status) return false;
        return true;
      });
    },
    async updateStatus(intentId, status) {
      const existing = map.get(intentId);
      if (!existing) throw new Error(`perps intent ${intentId} does not exist`);
      const updated = { ...existing, status, updatedAt: nowSeconds() };
      map.set(intentId, updated);
      nonceMap.set(traderNonceKey(updated.trader, updated.nonce), updated);
      return updated;
    },
    async recordFill(intentId, fillSizeDelta) {
      const existing = map.get(intentId);
      if (!existing) throw new Error(`perps intent ${intentId} does not exist`);
      const fill = applyFillToIntent(existing, fillSizeDelta);
      const updated = { ...existing, ...fill, updatedAt: nowSeconds() };
      map.set(intentId, updated);
      nonceMap.set(traderNonceKey(updated.trader, updated.nonce), updated);
      return updated;
    },
  };
}

function applyFillToIntent(
  intent: PerpIntent,
  fillSizeDelta: bigint,
): Pick<PerpIntent, "filledSizeDelta" | "remainingSizeDelta" | "status"> {
  const total = BigInt(intent.sizeDelta);
  const previousFilled = BigInt(intent.filledSizeDelta);
  if (fillSizeDelta === 0n) throw new Error("fill size must be nonzero");
  if (!sameSign(total, fillSizeDelta)) {
    throw new Error(`fill sign does not match order side for ${intent.intentId}`);
  }
  const nextFilled = previousFilled + fillSizeDelta;
  if (!sameSign(total, nextFilled) || abs(nextFilled) > abs(total)) {
    throw new Error(`fill exceeds remaining order quantity for ${intent.intentId}`);
  }
  const remaining = total - nextFilled;
  return {
    filledSizeDelta: nextFilled.toString(),
    remainingSizeDelta: remaining.toString(),
    status: remaining === 0n ? "filled" : "partially_filled",
  };
}

function traderNonceKey(trader: string, nonce: bigint): string {
  return `${trader.toLowerCase()}:${nonce.toString()}`;
}

function sameSign(a: bigint, b: bigint): boolean {
  return (a > 0n && b > 0n) || (a < 0n && b < 0n);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Map an indexed `perps_position` row to the wire `PerpQuote` shape the
 * frontend already consumes via `PerpsPositionDto`. We do not invent
 * a live mark price here — the reader may attach one; otherwise the
 * stored entry price is surfaced as a placeholder so the UI always has
 * a numeric mark to format.
 */
function mapIndexedPositionToPerpQuote(
  row: PerpsIndexedPosition,
  markets: MarketRegistryEntry[],
  maxOracleStaleSeconds: number,
  nowSec: number,
): PerpQuote {
  const sizeE18 = BigInt(row.sizeE18 ?? 0n);
  const entryE18 = BigInt(row.entryPriceE18 ?? 0n);
  const margin = BigInt(row.marginReserved ?? 0n);
  const market = markets.find(
    (m) => m.chainId === row.chainId && m.marketId.toLowerCase() === row.marketId.toLowerCase(),
  );
  // notional in USDC atomic units: |size_e18| * price_e18 / 1e30 (size 1e18, price 1e18, USDC 1e6)
  const absSize = sizeE18 < 0n ? -sizeE18 : sizeE18;
  const notionalAtomic = (absSize * entryE18) / 1_000_000_000_000_000_000_000_000_000_000n;
  const sizeUsdc = formatAtomicToUsdc(notionalAtomic);
  const leverage = margin > 0n ? Number(notionalAtomic / margin) : 1;
  const markE18 = BigInt(row.markPriceE18 ?? entryE18);
  return {
    marketId: row.marketId,
    side: sizeE18 < 0n ? "short" : "long",
    sizeUsdc,
    leverage: leverage > 0 ? leverage : 1,
    fee: "0",
    markPrice: markE18.toString(),
    requiredMargin: margin.toString(),
    maxLeverage: 50,
    oracleStaleSeconds: 0,
    oracle: {
      source: (market?.source === "pyth" ? "pyth" : "onchain") as "pyth" | "onchain",
      timestamp: row.updatedAt !== undefined ? Number(BigInt(row.updatedAt)) : nowSec,
      maxStaleSeconds: maxOracleStaleSeconds,
    },
  };
}

export function formatAtomicToUsdc(atomic: bigint): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
}

function serializeTypedData(value: ReturnType<typeof buildPerpsOrderTypedData>): PerpsIntentResponse["typedData"] {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}
