import type { PerpIntent } from "@bufi/shared-types";

export interface PriceTimeMatch {
  maker: PerpIntent;
  taker: PerpIntent;
  fillSizeE18: bigint;
  fillPriceE18: bigint;
  makerFillSizeDelta: bigint;
  takerFillSizeDelta: bigint;
  makerRemainingSizeDelta: bigint;
  takerRemainingSizeDelta: bigint;
}

interface BookOrder {
  intent: PerpIntent;
  remainingAbs: bigint;
  priceE18: bigint;
  createdAt: number;
}

export function matchPriceTimePriority(intents: PerpIntent[]): PriceTimeMatch[] {
  const matches: PriceTimeMatch[] = [];
  const used = new Set<string>();
  const marketIds = [...new Set(intents.map((intent) => intent.marketId.toLowerCase()))];

  for (const marketId of marketIds) {
    const active = intents.filter(
      (intent) =>
        intent.status === "pending" &&
        intent.marketId.toLowerCase() === marketId &&
        abs(remainingSizeDelta(intent)) > 0n,
    );
    const longs = active
      .filter((intent) => remainingSizeDelta(intent) > 0n)
      .map(toBookOrder)
      .sort(compareLongPriority);
    const shorts = active
      .filter((intent) => remainingSizeDelta(intent) < 0n)
      .map(toBookOrder)
      .sort(compareShortPriority);

    let longIndex = 0;
    let shortIndex = 0;
    while (longIndex < longs.length && shortIndex < shorts.length) {
      const long = nextUnused(longs, used, longIndex);
      const short = nextUnused(shorts, used, shortIndex);
      if (!long || !short) break;
      longIndex = Math.max(longIndex, longs.indexOf(long));
      shortIndex = Math.max(shortIndex, shorts.indexOf(short));

      if (!pricesCross(long, short)) {
        if (long.priceE18 === 0n) {
          shortIndex++;
          continue;
        }
        if (short.priceE18 === 0n) {
          longIndex++;
          continue;
        }
        break;
      }

      const [maker, taker] = chooseMakerTaker(long, short);
      if (!maker || !taker) {
        used.add(long.intent.intentId);
        used.add(short.intent.intentId);
        continue;
      }
      const fillPriceE18 = executionPrice(maker, taker);
      if (fillPriceE18 === 0n) {
        used.add(long.intent.intentId);
        used.add(short.intent.intentId);
        continue;
      }
      const fillSizeE18 = min(long.remainingAbs, short.remainingAbs);
      const makerSign = sign(remainingSizeDelta(maker.intent));
      const takerSign = sign(remainingSizeDelta(taker.intent));
      const makerFillSizeDelta = makerSign * fillSizeE18;
      const takerFillSizeDelta = takerSign * fillSizeE18;
      matches.push({
        maker: maker.intent,
        taker: taker.intent,
        fillSizeE18,
        fillPriceE18,
        makerFillSizeDelta,
        takerFillSizeDelta,
        makerRemainingSizeDelta: remainingSizeDelta(maker.intent) - makerFillSizeDelta,
        takerRemainingSizeDelta: remainingSizeDelta(taker.intent) - takerFillSizeDelta,
      });

      // FxOrderSettlement consumes the nonce on any fill, so each signed order
      // can be included in at most one on-chain settlement transaction.
      used.add(maker.intent.intentId);
      used.add(taker.intent.intentId);
    }
  }

  return matches;
}

function toBookOrder(intent: PerpIntent): BookOrder {
  return {
    intent,
    remainingAbs: abs(remainingSizeDelta(intent)),
    priceE18: BigInt(intent.priceE18),
    createdAt: intent.createdAt,
  };
}

function compareLongPriority(a: BookOrder, b: BookOrder): number {
  const price = comparePriceDesc(a, b);
  if (price !== 0) return price;
  return compareTime(a, b);
}

function compareShortPriority(a: BookOrder, b: BookOrder): number {
  const price = comparePriceAsc(a, b);
  if (price !== 0) return price;
  return compareTime(a, b);
}

function comparePriceDesc(a: BookOrder, b: BookOrder): number {
  if (a.priceE18 === b.priceE18) return 0;
  if (a.priceE18 === 0n) return -1;
  if (b.priceE18 === 0n) return 1;
  return a.priceE18 > b.priceE18 ? -1 : 1;
}

function comparePriceAsc(a: BookOrder, b: BookOrder): number {
  if (a.priceE18 === b.priceE18) return 0;
  if (a.priceE18 === 0n) return -1;
  if (b.priceE18 === 0n) return 1;
  return a.priceE18 < b.priceE18 ? -1 : 1;
}

function compareTime(a: BookOrder, b: BookOrder): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.intent.intentId.localeCompare(b.intent.intentId);
}

function pricesCross(long: BookOrder, short: BookOrder): boolean {
  if (long.priceE18 === 0n || short.priceE18 === 0n) return true;
  return long.priceE18 >= short.priceE18;
}

function chooseMakerTaker(a: BookOrder, b: BookOrder): [BookOrder | null, BookOrder | null] {
  if (a.intent.postOnly && b.intent.postOnly) return [null, null];
  if (a.intent.postOnly) return [a, b];
  if (b.intent.postOnly) return [b, a];
  return compareTime(a, b) <= 0 ? [a, b] : [b, a];
}

function executionPrice(maker: BookOrder, taker: BookOrder): bigint {
  if (maker.priceE18 !== 0n) return maker.priceE18;
  return taker.priceE18;
}

function nextUnused(orders: BookOrder[], used: Set<string>, from: number): BookOrder | null {
  for (let i = from; i < orders.length; i++) {
    if (!used.has(orders[i]!.intent.intentId)) return orders[i]!;
  }
  return null;
}

export function remainingSizeDelta(intent: PerpIntent): bigint {
  return BigInt(intent.remainingSizeDelta);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sign(value: bigint): 1n | -1n {
  return value < 0n ? -1n : 1n;
}
