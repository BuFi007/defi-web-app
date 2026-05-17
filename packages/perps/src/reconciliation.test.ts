import { describe, expect, test } from "bun:test";
import type { PerpIntent } from "@bufi/shared-types";

import {
  reconcilePerpsIntentWithSettlements,
  type PerpsIndexedSettlement,
} from "./reconciliation";

const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;
const trader = "0x0000000000000000000000000000000000000001" as const;
const counterparty = "0x0000000000000000000000000000000000000002" as const;

describe("perps reconciliation", () => {
  test("matches backend filled size against indexed settlement fills", () => {
    const reconciliation = reconcilePerpsIntentWithSettlements(
      intent({ filledSizeDelta: "400", remainingSizeDelta: "600", status: "partially_filled" }),
      [
        settlement({ fillSizeE18: "400", maker: trader, taker: counterparty }),
        settlement({ marketId: hex32("99"), fillSizeE18: "999", maker: trader }),
      ],
    );

    expect(reconciliation.status).toBe("matched");
    expect(reconciliation.backend.absFilledSizeE18).toBe("400");
    expect(reconciliation.indexed.absFilledSizeE18).toBe("400");
    expect(reconciliation.indexed.signedFillSizeDelta).toBe("400");
    expect(reconciliation.indexed.settlementCount).toBe(1);
    expect(reconciliation.discrepancies).toEqual([]);
  });

  test("flags when the backend has recorded a fill before Ponder catches up", () => {
    const reconciliation = reconcilePerpsIntentWithSettlements(
      intent({ filledSizeDelta: "-300", remainingSizeDelta: "-700", sizeDelta: "-1000", side: "short" }),
      [],
    );

    expect(reconciliation.status).toBe("backend_ahead_of_indexer");
    expect(reconciliation.indexed.signedFillSizeDelta).toBe("0");
    expect(reconciliation.discrepancies[0]).toContain("backend filled 300");
  });

  test("flags indexed fills not reflected in the intent store", () => {
    const reconciliation = reconcilePerpsIntentWithSettlements(intent(), [
      settlement({ fillSizeE18: 250n, taker: trader }),
    ]);

    expect(reconciliation.status).toBe("indexer_ahead_of_backend");
    expect(reconciliation.indexed.absFilledSizeE18).toBe("250");
  });
});

function intent(overrides: Partial<PerpIntent> = {}): PerpIntent {
  return {
    intentId: hex32("11"),
    chainId: 5042002,
    trader,
    marketId: hex32("22"),
    side: "long",
    sizeUsdc: "1.000000",
    sizeDelta: "1000",
    filledSizeDelta: "0",
    remainingSizeDelta: "1000",
    leverage: 5,
    orderType: "limit",
    priceE18: "1000000000000000000",
    reduceOnly: false,
    postOnly: false,
    flags: 0,
    digest: hex32("11"),
    signature: "0x1234",
    nonce: 1n,
    deadline: 1_800_000_000,
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function settlement(overrides: Partial<PerpsIndexedSettlement> = {}): PerpsIndexedSettlement {
  return {
    id: "settlement:1",
    chainId: 5042002,
    marketId: hex32("22"),
    maker: counterparty,
    taker: trader,
    fillSizeE18: "0",
    fillPriceE18: "1000000000000000000",
    txHash: hex32("aa"),
    ...overrides,
  };
}
