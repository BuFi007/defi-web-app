import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildPerpsOrderTypedData,
  buildSignedOrderMessage,
  hashPerpsOrder,
  orderFlags,
  signedSizeDelta,
  verifyPerpsOrderSignature,
} from "./typed-data";

const marketId = `0x${"11".repeat(32)}`;
const verifyingContract = `0x${"22".repeat(20)}`;

describe("perps SignedOrder typed data", () => {
  test("matches the Phase E SignedOrder contract shape", () => {
    const message = buildSignedOrderMessage({
      chainId: 5042002,
      trader: `0x${"aa".repeat(20)}`,
      marketId,
      side: "short",
      orderType: "limit",
      sizeUsdc: "10.500000",
      leverage: 5,
      priceE18: "1230000000000000000",
      reduceOnly: true,
      postOnly: true,
      nonce: "7",
      deadline: 1_800_000_000,
    });

    expect(message).toMatchObject({
      marketId,
      sizeDeltaE18: -10_500_000n,
      priceE18: 1_230_000_000_000_000_000n,
      orderType: 1,
      flags: 3,
      nonce: 7n,
    });
    expect(orderFlags({ reduceOnly: true, postOnly: false })).toBe(1);
    expect(signedSizeDelta({ side: "long", sizeDelta: "42", sizeUsdc: "1" })).toBe(42n);
  });

  test("verifies the trader EIP-712 signature", async () => {
    const account = privateKeyToAccount(
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    );
    const order = {
      chainId: 5042002 as const,
      trader: account.address,
      marketId,
      side: "long" as const,
      orderType: "market" as const,
      sizeUsdc: "1.000000",
      sizeDelta: "1000000",
      leverage: 2,
      priceE18: "0",
      reduceOnly: false,
      postOnly: false,
      nonce: "1",
      deadline: 1_800_000_000,
    };
    const previous = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({
      5042002: { perps: { orderSettlement: verifyingContract } },
    });
    try {
      const signature = await account.signTypedData(buildPerpsOrderTypedData(order));
      expect(buildPerpsOrderTypedData(order).domain.name).toBe("TelaranaFxOrderSettlement");
      expect(buildPerpsOrderTypedData(order).types.SignedOrder[2]).toEqual({
        name: "sizeDeltaE18",
        type: "int256",
      });
      expect(hashPerpsOrder(order)).toMatch(/^0x[a-f0-9]{64}$/);
      expect(await verifyPerpsOrderSignature({ ...order, signature })).toBe(true);
      expect(
        await verifyPerpsOrderSignature({
          ...order,
          trader: `0x${"bb".repeat(20)}`,
          signature,
        }),
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      } else {
        process.env.CONTRACT_ADDRESSES_JSON = previous;
      }
    }
  });
});
