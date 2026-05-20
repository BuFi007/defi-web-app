import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  SIGNED_ORDER_TYPES,
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
  // Regression guard: the on-chain typehash in FxOrderSettlement.sol has
  // 9 fields with `maxFee:uint256` between `priceE18` and `orderType`.
  // Drift here = every trader-side signature reverts with InvalidSignature.
  test("SignedOrder schema mirrors FxOrderSettlement.SIGNED_ORDER_TYPEHASH exactly", () => {
    expect(SIGNED_ORDER_TYPES.SignedOrder).toEqual([
      { name: "trader", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "sizeDeltaE18", type: "int256" },
      { name: "priceE18", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "orderType", type: "uint8" },
      { name: "flags", type: "uint8" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ]);
  });

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
      maxFee: 0n,
      orderType: 1,
      flags: 3,
      nonce: 7n,
    });
    expect(orderFlags({ reduceOnly: true, postOnly: false })).toBe(1);
    expect(signedSizeDelta({ side: "long", sizeDelta: "42", sizeUsdc: "1" })).toBe(42n);
  });

  test("maxFee round-trips when explicitly set", () => {
    const message = buildSignedOrderMessage({
      chainId: 5042002,
      trader: `0x${"aa".repeat(20)}`,
      marketId,
      side: "long",
      orderType: "market",
      sizeUsdc: "1.000000",
      leverage: 1,
      priceE18: "1000000000000000000",
      maxFee: "5000",
      reduceOnly: false,
      nonce: "0",
      deadline: 1_800_000_000,
    });
    expect(message.maxFee).toBe(5_000n);
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
