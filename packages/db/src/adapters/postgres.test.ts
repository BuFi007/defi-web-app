import { describe, expect, test } from "bun:test";

import type { DomainEvent, PerpIntent, WorkflowState } from "@bufi/shared-types";

import { createPostgresTradingMachineDb } from "./postgres";

// The scaffolded Postgres adapter is wired into the public surface but every
// method throws `postgres adapter: <name> not yet implemented`. These tests
// pin that contract so the wiring compiles even without a live Postgres and
// the future implementer can flip them off method-by-method as bodies land.

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

function tryLoadPg(): boolean {
  try {
    // Same Function-indirected require the adapter uses, so behavior matches.
    const req = Function("m", "return require(m)") as (moduleId: string) => unknown;
    req("pg");
    return true;
  } catch {
    return false;
  }
}

const pgInstalled = tryLoadPg();
// When `pg` is not installed (the default in this monorepo today) the
// constructor itself throws with the peer-missing hint. We still want to
// prove construction WORKS when `pg` IS present — but cannot require it.
const describeIfPg = pgInstalled ? describe : describe.skip;
const describeIfNoPg = pgInstalled ? describe.skip : describe;

describeIfNoPg("postgres adapter (pg peer not installed)", () => {
  test("createPostgresTradingMachineDb throws a helpful peer-missing error", () => {
    expect(() =>
      createPostgresTradingMachineDb({ connectionString: "postgres://localhost/bufi" }),
    ).toThrow(/optional peer dependency `pg`/);
  });

  test("createPostgresTradingMachineDb rejects empty connectionString without touching pg", () => {
    expect(() => createPostgresTradingMachineDb({ connectionString: "" })).toThrow(
      /connectionString is required/,
    );
  });
});

describeIfPg("postgres adapter (scaffolded, pg peer installed)", () => {
  // We can construct because `pg.Pool` accepts a connection string lazily —
  // no socket is opened until a query runs. Every persistence method must
  // throw the canonical not-yet-implemented marker. Construction is lazy so
  // the top-level `loadPgModule()` only runs when this block is selected.
  let db: ReturnType<typeof createPostgresTradingMachineDb>;
  function getDb() {
    if (!db) {
      db = createPostgresTradingMachineDb({
        connectionString: "postgres://bufi:bufi@127.0.0.1:5432/bufi_test_scaffold",
      });
    }
    return db;
  }

  test("perpsIntents methods all throw not-yet-implemented", async () => {
    const db = getDb();
    const sample = intent();
    await expect(db.perpsIntents.put(sample)).rejects.toThrow(
      "postgres adapter: perpsIntents.put not yet implemented",
    );
    await expect(db.perpsIntents.get(sample.intentId)).rejects.toThrow(
      "postgres adapter: perpsIntents.get not yet implemented",
    );
    await expect(db.perpsIntents.getByTraderNonce(trader, 1n)).rejects.toThrow(
      "postgres adapter: perpsIntents.getByTraderNonce not yet implemented",
    );
    await expect(db.perpsIntents.list()).rejects.toThrow(
      "postgres adapter: perpsIntents.list not yet implemented",
    );
    await expect(db.perpsIntents.updateStatus(sample.intentId, "filled")).rejects.toThrow(
      "postgres adapter: perpsIntents.updateStatus not yet implemented",
    );
    await expect(db.perpsIntents.recordFill(sample.intentId, 1n)).rejects.toThrow(
      "postgres adapter: perpsIntents.recordFill not yet implemented",
    );
  });

  test("workflows methods all throw not-yet-implemented", async () => {
    const db = getDb();
    const workflow: WorkflowState = {
      workflowId: "wf_pg_scaffold",
      toolName: "bufx.quote.perp",
      session: { address: null, chainId: null },
      status: "draft",
      input: {},
      createdAt: 1,
      updatedAt: 1,
      audit: [],
    };
    await expect(db.workflows.create(workflow)).rejects.toThrow(
      "postgres adapter: workflows.create not yet implemented",
    );
    await expect(db.workflows.get(workflow.workflowId)).rejects.toThrow(
      "postgres adapter: workflows.get not yet implemented",
    );
    await expect(db.workflows.put(workflow)).rejects.toThrow(
      "postgres adapter: workflows.put not yet implemented",
    );
    await expect(db.workflows.list()).rejects.toThrow(
      "postgres adapter: workflows.list not yet implemented",
    );
  });

  test("receipts methods all throw not-yet-implemented", async () => {
    const db = getDb();
    const receipt = {
      payer: trader,
      amountUsdc: "1000",
      settlementTx: "0xabc",
      network: "mock-testnet",
      receiptId: "receipt_pg_scaffold",
      paidAtUnixSeconds: 2,
    };
    await expect(db.receipts.put("bufx.quote.perp.premium", receipt)).rejects.toThrow(
      "postgres adapter: receipts.put not yet implemented",
    );
    await expect(db.receipts.list({})).rejects.toThrow(
      "postgres adapter: receipts.list not yet implemented",
    );
    await expect(db.receipts.has(receipt.receiptId)).rejects.toThrow(
      "postgres adapter: receipts.has not yet implemented",
    );
    await expect(db.receipts.get(receipt.receiptId)).rejects.toThrow(
      "postgres adapter: receipts.get not yet implemented",
    );
  });

  test("events methods all throw not-yet-implemented", async () => {
    const db = getDb();
    const event: DomainEvent = {
      eventId: "evt_pg_scaffold",
      type: "bufx.perps.replacement_needed",
      aggregateId: hex32("66"),
      actor: trader,
      payload: {},
      createdAt: 3,
    };
    await expect(db.events.put(event)).rejects.toThrow(
      "postgres adapter: events.put not yet implemented",
    );
    await expect(db.events.get(event.eventId)).rejects.toThrow(
      "postgres adapter: events.get not yet implemented",
    );
    await expect(db.events.list()).rejects.toThrow(
      "postgres adapter: events.list not yet implemented",
    );
  });

  test("readStore methods all throw not-yet-implemented", async () => {
    const db = getDb();
    await expect(db.readStore.markets()).rejects.toThrow(
      "postgres adapter: readStore.markets not yet implemented",
    );
    await expect(db.readStore.perpPositions(trader)).rejects.toThrow(
      "postgres adapter: readStore.perpPositions not yet implemented",
    );
    await expect(db.readStore.perpIntent("intent")).rejects.toThrow(
      "postgres adapter: readStore.perpIntent not yet implemented",
    );
    await expect(db.readStore.bentoRooms()).rejects.toThrow(
      "postgres adapter: readStore.bentoRooms not yet implemented",
    );
    await expect(db.readStore.bentoRoom("room")).rejects.toThrow(
      "postgres adapter: readStore.bentoRoom not yet implemented",
    );
    await expect(db.readStore.telaranaPositions(trader)).rejects.toThrow(
      "postgres adapter: readStore.telaranaPositions not yet implemented",
    );
  });

  test("close() does not throw on a pool that never opened a socket", () => {
    const db = getDb();
    expect(() => db.close()).not.toThrow();
  });
});
