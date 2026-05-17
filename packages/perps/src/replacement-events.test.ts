import { describe, expect, test } from "bun:test";
import type { PerpIntent } from "@bufi/shared-types";

import {
  PERPS_REPLACEMENT_MCP_TOOL,
  PERPS_REPLACEMENT_NEEDED_EVENT,
  buildPerpsReplacementNeededEvent,
} from "./replacement-events";

const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;
const trader = "0x0000000000000000000000000000000000000001" as const;

describe("perps replacement events", () => {
  test("builds an idempotent outbox event for a partial residual", () => {
    const event = buildPerpsReplacementNeededEvent({
      intent: intent({
        intentId: hex32("aa"),
        filledSizeDelta: "400",
        remainingSizeDelta: "600",
        status: "partially_filled",
      }),
      settlementTx: hex32("bb"),
      role: "taker",
      counterpartyIntentId: hex32("cc"),
      fillSizeDelta: 400n,
      fillPriceE18: 1_000_000_000_000_000_000n,
      emittedAt: 1_700_000_000,
    });

    expect(event).toMatchObject({
      eventId: `perps-replacement-needed:${hex32("bb")}:${hex32("aa")}`,
      type: PERPS_REPLACEMENT_NEEDED_EVENT,
      aggregateId: hex32("aa"),
      actor: trader,
      createdAt: 1_700_000_000,
    });
    expect(event.payload).toMatchObject({
      intentId: hex32("aa"),
      remainingSizeDelta: "600",
      role: "taker",
      counterpartyIntentId: hex32("cc"),
      fillSizeDelta: "400",
      fillPriceE18: "1000000000000000000",
      prepareApiPath: `/perps/intents/${hex32("aa")}/replacement/prepare`,
      mcpToolName: PERPS_REPLACEMENT_MCP_TOOL,
    });
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
