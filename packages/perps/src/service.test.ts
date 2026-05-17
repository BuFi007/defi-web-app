import { describe, expect, test } from "bun:test";
import type { MarketRegistryEntry } from "@bufi/shared-types";
import { privateKeyToAccount } from "viem/accounts";

import { createInMemoryPerpsIntentStore, createPerpsService } from "./service";
import { buildPerpsOrderTypedData } from "./typed-data";

const marketId = `0x${"11".repeat(32)}`;

describe("perps service", () => {
  test("requires contract-native sizeDelta for live quotes", async () => {
    const service = createPerpsService({
      markets: [market()],
      quoteReader: {
        async quoteFee() {
          throw new Error("quote reader should not be called without sizeDelta");
        },
      },
    });

    await expect(
      service.quote({
        chainId: 5042002,
        marketId,
        side: "long",
        sizeUsdc: "1.000000",
        leverage: 5,
      }),
    ).rejects.toThrow("sizeDelta is required");
  });

  test("prepares and accepts a fresh-nonce replacement for a partial residual", async () => {
    const account = privateKeyToAccount(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const store = createInMemoryPerpsIntentStore();
    const service = createPerpsService({
      markets: [market()],
      intentStore: store,
      now: () => 1_700_000_000,
    });
    const originalOrder = {
      chainId: 5042002 as const,
      trader: account.address,
      marketId,
      side: "long" as const,
      sizeUsdc: "1.000000",
      sizeDelta: "1000",
      leverage: 5,
      orderType: "limit" as const,
      priceE18: "1000000000000000000",
      reduceOnly: false,
      postOnly: true,
      nonce: "1",
      deadline: 1_800_000_000,
    };
    const originalSignature = await account.signTypedData(buildPerpsOrderTypedData(originalOrder));
    const original = await service.createIntent({ ...originalOrder, signature: originalSignature });
    await store.recordFill(original.intentId, 400n);

    const prepared = await service.prepareReplacementIntent({
      originalIntentId: original.intentId,
      nonce: "2",
      deadline: 1_800_000_100,
    });

    expect(prepared.replacementOf).toBe(original.intentId);
    expect(prepared.remainingSizeDelta).toBe("600");
    expect(prepared.typedData.message.sizeDeltaE18).toBe("600");
    expect(prepared.typedData.message.nonce).toBe("2");
    expect(prepared.typedData.message.flags).toBe(2);

    const replacementOrder = {
      ...originalOrder,
      sizeDelta: "600",
      nonce: "2",
      deadline: 1_800_000_100,
    };
    const replacementSignature = await account.signTypedData(buildPerpsOrderTypedData(replacementOrder));
    const accepted = await service.createReplacementIntent({
      originalIntentId: original.intentId,
      nonce: "2",
      deadline: 1_800_000_100,
      signature: replacementSignature,
    });

    expect(accepted.replacementOf).toBe(original.intentId);
    const storedReplacement = await store.get(accepted.intentId);
    expect(storedReplacement?.replacementOf).toBe(original.intentId);
    expect(storedReplacement?.sizeDelta).toBe("600");
    expect(storedReplacement?.remainingSizeDelta).toBe("600");
    expect(storedReplacement?.status).toBe("pending");

    const retry = await service.createReplacementIntent({
      originalIntentId: original.intentId,
      nonce: "2",
      deadline: 1_800_000_100,
      signature: replacementSignature,
    });
    expect(retry.intentId).toBe(accepted.intentId);

    await expect(
      service.prepareReplacementIntent({
        originalIntentId: original.intentId,
        nonce: "3",
        deadline: 1_800_000_200,
      }),
    ).rejects.toThrow("replacement already exists");
  });
});

function market(): MarketRegistryEntry {
  return {
    marketId,
    symbol: "EURC/USDC",
    baseAsset: `0x${"22".repeat(20)}`,
    quoteAsset: `0x${"33".repeat(20)}`,
    source: "pyth",
    chainId: 5042002,
    enabled: true,
  };
}
