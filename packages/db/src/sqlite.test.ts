import { describe, expect, test } from "bun:test";

import type { PerpIntent, WorkflowState } from "@bufi/shared-types";

import { createSqliteTradingMachineDb } from "./index";

const trader = "0x0000000000000000000000000000000000000001" as const;
const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;

function intent(overrides: Partial<PerpIntent> = {}): PerpIntent {
  return {
    intentId: hex32("11"),
    chainId: 5042002,
    trader,
    marketId: hex32("22"),
    side: "long",
    sizeUsdc: "10.000000",
    sizeDelta: "10000000",
    filledSizeDelta: "0",
    remainingSizeDelta: "10000000",
    leverage: 5,
    orderType: "limit",
    priceE18: "1000000000000000000",
    limitPrice: "1000000000000000000",
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

describe("sqlite trading machine db", () => {
  test("persists perps intents and enforces trader nonce uniqueness", async () => {
    const db = createSqliteTradingMachineDb({ path: ":memory:" });
    const first = intent();
    await db.perpsIntents.put(first);
    await db.perpsIntents.put(first);

    expect(await db.perpsIntents.get(first.intentId)).toEqual(first);
    expect(await db.perpsIntents.getByTraderNonce(trader, 1n)).toEqual(first);
    expect(await db.perpsIntents.list({ trader })).toHaveLength(1);

    const filled = await db.perpsIntents.updateStatus(first.intentId, "filled");
    expect(filled.status).toBe("filled");
    expect((await db.perpsIntents.get(first.intentId))?.status).toBe("filled");

    const partial = intent({
      intentId: hex32("44"),
      digest: hex32("44"),
      nonce: 2n,
    });
    await db.perpsIntents.put(partial);
    const partiallyFilled = await db.perpsIntents.recordFill(partial.intentId, 4_000_000n);
    expect(partiallyFilled.status).toBe("partially_filled");
    expect(partiallyFilled.filledSizeDelta).toBe("4000000");
    expect(partiallyFilled.remainingSizeDelta).toBe("6000000");
    const fullyFilled = await db.perpsIntents.recordFill(partial.intentId, 6_000_000n);
    expect(fullyFilled.status).toBe("filled");
    expect(fullyFilled.remainingSizeDelta).toBe("0");

    const replacement = intent({
      intentId: hex32("55"),
      replacementOf: partial.intentId,
      digest: hex32("55"),
      nonce: 3n,
      sizeDelta: "6000000",
      remainingSizeDelta: "6000000",
    });
    await db.perpsIntents.put(replacement);
    expect((await db.perpsIntents.get(replacement.intentId))?.replacementOf).toBe(partial.intentId);

    const conflict = intent({
      intentId: hex32("33"),
      digest: hex32("33"),
      nonce: 1n,
    });
    await expect(db.perpsIntents.put(conflict)).rejects.toThrow("nonce already used");
    db.close();
  });

  test("persists workflow state and x402 receipts", async () => {
    const db = createSqliteTradingMachineDb({ path: ":memory:" });
    const workflow: WorkflowState = {
      workflowId: "wf_test",
      toolName: "bufx.quote.perp",
      session: { address: null, chainId: null },
      status: "draft",
      input: { marketId: "EUR/USD" },
      createdAt: 1,
      updatedAt: 1,
      audit: [{ at: 1, actor: "anon", event: "draft.created" }],
    };
    await db.workflows.create(workflow);
    await db.workflows.put({ ...workflow, status: "completed", updatedAt: 2 });

    expect((await db.workflows.get("wf_test"))?.status).toBe("completed");
    expect(await db.workflows.list({ status: "completed" })).toHaveLength(1);

    await db.receipts.put("bufx.quote.perp.premium", {
      payer: trader,
      amountUsdc: "1000",
      settlementTx: "0xabc",
      network: "mock-testnet",
      receiptId: "receipt_1",
      paidAtUnixSeconds: 2,
    });
    expect(await db.receipts.has("receipt_1")).toBe(true);
    expect((await db.receipts.get("receipt_1"))?.payer).toBe(trader);
    expect((await db.receipts.get("receipt_1"))?.toolName).toBe("bufx.quote.perp.premium");

    await db.events.put({
      eventId: "evt_1",
      type: "bufx.perps.replacement_needed",
      aggregateId: hex32("66"),
      actor: trader,
      payload: { intentId: hex32("66"), remainingSizeDelta: "6000000" },
      createdAt: 3,
    });
    await db.events.put({
      eventId: "evt_1",
      type: "bufx.perps.replacement_needed",
      aggregateId: hex32("66"),
      actor: trader,
      payload: { duplicated: true },
      createdAt: 4,
    });
    await db.events.put({
      eventId: "evt_2",
      type: "bufx.perps.other",
      aggregateId: hex32("77"),
      payload: { ignored: true },
      createdAt: 5,
    });
    expect(await db.events.list({ type: "bufx.perps.replacement_needed", actor: trader })).toEqual([
      {
        eventId: "evt_1",
        type: "bufx.perps.replacement_needed",
        aggregateId: hex32("66"),
        actor: trader,
        payload: { intentId: hex32("66"), remainingSizeDelta: "6000000" },
        createdAt: 3,
      },
    ]);
    expect(await db.events.list({ after: 3 })).toHaveLength(1);
    db.close();
  });
});
