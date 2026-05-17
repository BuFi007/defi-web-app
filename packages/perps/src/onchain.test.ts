import { describe, expect, test } from "bun:test";
import type { MarketRegistryEntry } from "@bufi/shared-types";
import type { PublicClient } from "viem";

import {
  createViemPerpsNonceReader,
  createViemPerpsQuoteReader,
  requiredMarginFromNotional,
} from "./onchain";

const marketId = `0x${"44".repeat(32)}`;
const clearinghouse = `0x${"55".repeat(20)}`;
const oracle = `0x${"66".repeat(20)}`;
const orderSettlement = `0x${"aa".repeat(20)}`;

describe("viem perps quote reader", () => {
  test("reads quoteFee and oracle timestamp from contracts", async () => {
    const previous = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({
      5042002: {
        telarana: { fxOracle: oracle },
        perps: { clearinghouse },
      },
    });
    const calls: Array<{ functionName: string; args: unknown[] }> = [];
    const client = {
      async readContract(call: { functionName: string; args: unknown[] }) {
        calls.push({ functionName: call.functionName, args: call.args });
        if (call.functionName === "quoteFee") return [123n, 2_000_000_000_000_000_000n];
        if (call.functionName === "getMid") return [2_000_000_000_000_000_000n, 1000n];
        throw new Error(`unexpected function ${call.functionName}`);
      },
    } as unknown as PublicClient;

    try {
      const reader = createViemPerpsQuoteReader({
        markets: [testMarket()],
        clientForChain: () => client,
        now: () => 1012,
      });
      const quote = await reader.quoteFee({
        chainId: 5042002,
        marketId,
        trader: `0x${"77".repeat(20)}`,
        side: "long",
        sizeUsdc: "10.000000",
        sizeDelta: "2500",
        leverage: 5,
      });

      expect(quote).toEqual({
        fee: "123",
        markPrice: "2000000000000000000",
        requiredMargin: "2000000",
        maxLeverage: 50,
        oracleTimestamp: 1000,
        oracleStaleSeconds: 12,
      });
      expect(calls[0]?.args).toEqual([marketId, `0x${"77".repeat(20)}`, 2500n]);
    } finally {
      if (previous === undefined) {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      } else {
        process.env.CONTRACT_ADDRESSES_JSON = previous;
      }
    }
  });

  test("rounds required margin up to the next micro-USDC", () => {
    expect(requiredMarginFromNotional("10.000001", 3)).toBe(3_333_334n);
  });

  test("checks the order settlement nonce bitmap", async () => {
    const previous = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({
      5042002: { perps: { orderSettlement } },
    });
    const client = {
      async readContract(call: { functionName: string; args: unknown[] }) {
        expect(call.functionName).toBe("nonceBitmap");
        expect(call.args[1]).toBe(1n);
        return 4n;
      },
    } as unknown as PublicClient;

    try {
      const reader = createViemPerpsNonceReader({ clientForChain: () => client });
      expect(await reader.isNonceUsed(5042002, `0x${"77".repeat(20)}`, 258n)).toBe(true);
      expect(await reader.isNonceUsed(5042002, `0x${"77".repeat(20)}`, 257n)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      } else {
        process.env.CONTRACT_ADDRESSES_JSON = previous;
      }
    }
  });
});

function testMarket(): MarketRegistryEntry {
  return {
    marketId,
    symbol: "USD/JPY",
    baseAsset: `0x${"88".repeat(20)}`,
    quoteAsset: `0x${"99".repeat(20)}`,
    source: "pyth",
    chainId: 5042002,
    enabled: true,
  };
}
