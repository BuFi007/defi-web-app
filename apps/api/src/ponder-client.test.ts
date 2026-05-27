import { afterEach, describe, expect, mock, test } from "bun:test";

import { createPonderPerpsSettlementReader } from "./ponder-client";

const originalFetch = globalThis.fetch;
const marketId = `0x${"11".repeat(32)}`;
const txHash = `0x${"22".repeat(32)}`;
const maker = "0x0000000000000000000000000000000000000001";
const taker = "0x0000000000000000000000000000000000000002";

describe("Envio perps settlement reader", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("normalizes and filters indexed settlements", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: {
          PerpTrade: {
            items: [
              settlementRow(),
              settlementRow({ id: "other-chain", chainId: 43113 }),
              settlementRow({
                id: "other-trader",
                maker: "0x0000000000000000000000000000000000000003",
                taker: "0x0000000000000000000000000000000000000004",
              }),
            ],
          },
        },
      }),
    ) as unknown as typeof fetch;

    const reader = createPonderPerpsSettlementReader("http://envio.local/graphql");
    const rows = await reader.listSettlements({
      chainId: 5042002,
      marketId,
      trader: taker,
      txHash,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "settlement:1",
      chainId: 5042002,
      marketId,
      maker,
      taker,
      fillSizeE18: "400000000000000000",
      fillPriceE18: "1000000000000000000",
      txHash,
      logIndex: 7,
    });
  });

  test("rejects malformed GraphQL settlement rows", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: {
          PerpTrade: {
            items: [settlementRow({ fillSizeE18: "-1" })],
          },
        },
      }),
    ) as unknown as typeof fetch;

    const reader = createPonderPerpsSettlementReader("http://envio.local/graphql");
    await expect(
      reader.listSettlements({
        chainId: 5042002,
        marketId,
        trader: taker,
      }),
    ).rejects.toThrow("Envio GraphQL response invalid");
  });
});

function settlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "settlement:1",
    chainId: 5042002,
    marketId,
    maker,
    taker,
    fillSizeE18: "400000000000000000",
    fillPriceE18: "1000000000000000000",
    blockNumber: "123",
    blockTimestamp: "456",
    txHash,
    logIndex: 7,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
