import { describe, expect, test } from "bun:test";
import type { PerpIntent } from "@bufi/shared-types";

import { matchPriceTimePriority } from "./orderbook";

const marketId = `0x${"11".repeat(32)}`;
const trader = (byte: string) => `0x${byte.repeat(20)}` as const;
const hex32 = (byte: string) => `0x${byte.repeat(32)}` as const;

describe("price-time perps orderbook", () => {
  test("prioritizes better price, then earlier time, and records partial residuals", () => {
    const olderLong = intent("aa", {
      trader: trader("a1"),
      side: "long",
      sizeDelta: "600",
      remainingSizeDelta: "600",
      priceE18: "100",
      createdAt: 10,
    });
    const betterLong = intent("bb", {
      trader: trader("b2"),
      side: "long",
      sizeDelta: "1000",
      remainingSizeDelta: "1000",
      priceE18: "105",
      createdAt: 20,
    });
    const short = intent("cc", {
      trader: trader("c3"),
      side: "short",
      sizeDelta: "-400",
      remainingSizeDelta: "-400",
      priceE18: "99",
      postOnly: true,
      flags: 2,
      createdAt: 30,
    });

    const [match] = matchPriceTimePriority([olderLong, betterLong, short]);

    expect(match?.maker.intentId).toBe(short.intentId);
    expect(match?.taker.intentId).toBe(betterLong.intentId);
    expect(match?.fillSizeE18).toBe(400n);
    expect(match?.fillPriceE18).toBe(99n);
    expect(match?.makerFillSizeDelta).toBe(-400n);
    expect(match?.takerFillSizeDelta).toBe(400n);
    expect(match?.makerRemainingSizeDelta).toBe(0n);
    expect(match?.takerRemainingSizeDelta).toBe(600n);
  });

  test("does not cross non-marketable limit orders", () => {
    const long = intent("dd", {
      trader: trader("d4"),
      side: "long",
      sizeDelta: "100",
      remainingSizeDelta: "100",
      priceE18: "99",
    });
    const short = intent("ee", {
      trader: trader("e5"),
      side: "short",
      sizeDelta: "-100",
      remainingSizeDelta: "-100",
      priceE18: "100",
    });

    expect(matchPriceTimePriority([long, short])).toEqual([]);
  });

  test("uses the limit side price when a market order crosses", () => {
    const marketLong = intent("f1", {
      trader: trader("f1"),
      side: "long",
      sizeDelta: "100",
      remainingSizeDelta: "100",
      orderType: "market",
      priceE18: "0",
      createdAt: 20,
    });
    const limitShort = intent("f2", {
      trader: trader("f2"),
      side: "short",
      sizeDelta: "-100",
      remainingSizeDelta: "-100",
      priceE18: "101",
      createdAt: 10,
    });

    const [match] = matchPriceTimePriority([marketLong, limitShort]);

    expect(match?.maker.intentId).toBe(limitShort.intentId);
    expect(match?.fillPriceE18).toBe(101n);
  });
});

function intent(byte: string, overrides: Partial<PerpIntent>): PerpIntent {
  const sizeDelta = overrides.sizeDelta ?? "100";
  return {
    intentId: hex32(byte.slice(0, 2)),
    chainId: 5042002,
    trader: trader(byte.slice(0, 2)),
    marketId,
    side: "long",
    sizeUsdc: "1.000000",
    sizeDelta,
    filledSizeDelta: "0",
    remainingSizeDelta: sizeDelta,
    leverage: 5,
    orderType: "limit",
    priceE18: "100",
    reduceOnly: false,
    postOnly: false,
    flags: 0,
    digest: hex32(byte.slice(0, 2)),
    signature: "0x1234",
    nonce: BigInt(`0x${byte.slice(0, 2)}`),
    deadline: 1_800_000_000,
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
