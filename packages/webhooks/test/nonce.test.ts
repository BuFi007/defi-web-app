import { describe, expect, test } from "bun:test";

import { buildNonce, nonceForEvent } from "../src/nonce";
import type {
  FillWebhookEvent,
  FundingWebhookEvent,
  LiquidationWebhookEvent,
} from "../src/types";

describe("nonce derivation", () => {
  test("buildNonce lowercases hex inputs for stability", () => {
    const a = buildNonce({
      eventType: "fill",
      marketId: "0xABCD",
      txHash: "0xDEAD",
      logIndex: 7,
    });
    const b = buildNonce({
      eventType: "fill",
      marketId: "0xabcd",
      txHash: "0xdead",
      logIndex: "7",
    });
    expect(a).toBe(b);
    expect(a).toBe("fill-0xabcd-0xdead-7");
  });

  test("nonceForEvent fill includes taker into the index slot", () => {
    const event: FillWebhookEvent = {
      type: "fill",
      chainId: 1,
      marketId: "0xMARKET",
      maker: "0xMAKER",
      taker: "0xTAKER",
      priceE18: "0",
      sizeE18: "0",
      txHash: "0xTX",
      blockNumber: 99,
      ts: 0,
    };
    expect(nonceForEvent(event)).toBe(
      "fill-0xmarket-0xtx-99-0xtaker",
    );
  });

  test("nonceForEvent funding uses (marketId, version) — same content always same nonce", () => {
    const event: FundingWebhookEvent = {
      type: "funding",
      chainId: 1,
      marketId: "0xMARKET",
      rateE18: "0",
      markE18: "0",
      cumulativeFundingE18: "0",
      version: 42,
      ts: 1,
    };
    const expected = `funding-0xmarket-0x${"0".repeat(64)}-42`;
    expect(nonceForEvent(event)).toBe(expected);
    // Re-derivation is stable
    expect(nonceForEvent({ ...event, ts: 999 })).toBe(expected);
  });

  test("nonceForEvent liquidation includes trader into the index slot", () => {
    const event: LiquidationWebhookEvent = {
      type: "liquidation",
      chainId: 1,
      marketId: "0xMARKET",
      trader: "0xTRADER",
      liquidator: "0xLIQ",
      rewardAtomic: "0",
      socializedLossAtomic: "0",
      txHash: "0xTX",
      blockNumber: 7,
      ts: 0,
    };
    expect(nonceForEvent(event)).toBe(
      "liquidation-0xmarket-0xtx-7-0xtrader",
    );
  });
});
