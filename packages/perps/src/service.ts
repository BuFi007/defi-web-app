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
    maxLeverage: number;
    oracleTimestamp: number;
    oracleStaleSeconds: number;
  }>;
}

export interface PerpsNonceReader {
  isNonceUsed(chainId: number, trader: string, nonce: bigint): Promise<boolean>;
}

export interface PerpsIntentStore {
  put(intent: PerpIntent): Promise<void>;
  get(intentId: string): Promise<PerpIntent | null>;
  getByTraderNonce(trader: string, nonce: bigint): Promise<PerpIntent | null>;
  list(filter?: { trader?: string; status?: PerpIntent["status"] }): Promise<PerpIntent[]>;
  updateStatus(intentId: string, status: PerpIntent["status"]): Promise<PerpIntent>;
  recordFill(intentId: string, fillSizeDelta: bigint): Promise<PerpIntent>;
}

export interface CreatePerpsServiceOptions {
  markets?: MarketRegistryEntry[];
  quoteReader?: PerpsQuoteReader;
  nonceReader?: PerpsNonceReader;
  intentStore?: PerpsIntentStore;
  maxOracleStaleSeconds?: number;
  now?: () => number;
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
    async listPositions() {
      return [];
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

function serializeTypedData(value: ReturnType<typeof buildPerpsOrderTypedData>): PerpsIntentResponse["typedData"] {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}
