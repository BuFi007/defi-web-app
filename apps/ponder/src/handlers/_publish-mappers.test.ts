/**
 * Unit tests for the Wave F2 publish mappers.
 *
 * Run with `bun test apps/ponder/src/handlers/_publish-mappers.test.ts`.
 * No Ponder runtime needed — these are pure functions over event args.
 */
import { describe, expect, test } from "bun:test";

import {
  blockTimestampToMs,
  buildEventId,
  buildMatchSettledRow,
  buildPositionDecreasedRow,
  buildPositionIncreasedRow,
  buildTradeMessage,
  deltaSign,
  lowerHex,
} from "./_publish-mappers";

const marketId = `0x${"11".repeat(32)}`;
const txHash = `0x${"22".repeat(32)}`;
const taker = "0xAaAaaAAAAAaaaAaaAAaAAAAAAAAaAaaAaaaaAA01";
const maker = "0xBbbBBBbBBbbBbBbbBbBBBbbBbBBbbBBBBbBBbb02";

const baseMeta = {
  chainId: 5042002,
  blockNumber: 12345n,
  blockTimestamp: 1700000000n,
  txHash,
  logIndex: 7,
};

describe("lowerHex", () => {
  test("downcases mixed-case hex", () => {
    expect(lowerHex(taker)).toBe(taker.toLowerCase());
  });
});

describe("buildEventId", () => {
  test("formats txHash-logIndex with lowercased tx hash", () => {
    expect(buildEventId(txHash, 9)).toBe(`${txHash}-9`);
    expect(buildEventId("0xABCDEF", 0)).toBe("0xabcdef-0");
  });
});

describe("blockTimestampToMs", () => {
  test("multiplies seconds by 1000", () => {
    expect(blockTimestampToMs(1_700_000_000n)).toBe(1_700_000_000_000);
  });
  test("clamps adversarial bigint above Number.MAX_SAFE_INTEGER", () => {
    expect(blockTimestampToMs(9_999_999_999_999_999n)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("deltaSign", () => {
  test("positive int256 → long", () => {
    expect(deltaSign(123n)).toBe("long");
  });
  test("negative int256 → short", () => {
    expect(deltaSign(-1n)).toBe("short");
  });
  test("zero defaults to long", () => {
    expect(deltaSign(0n)).toBe("long");
  });
});

describe("buildMatchSettledRow", () => {
  test("populates the columns the on-chain event carries", () => {
    const row = buildMatchSettledRow(
      {
        marketId,
        maker,
        taker,
        fillSizeE18: 1_000_000_000_000_000_000n,
        fillPriceE18: 1_080_000_000_000_000_000n,
      },
      baseMeta,
    );

    expect(row).toEqual({
      eventId: `${txHash}-${baseMeta.logIndex}`,
      chainId: baseMeta.chainId,
      blockNumber: "12345",
      txHash: txHash.toLowerCase(),
      logIndex: 7,
      marketId: marketId.toLowerCase(),
      taker: taker.toLowerCase(),
      maker: maker.toLowerCase(),
      sizeDelta: "1000000000000000000",
      priceE18: "1080000000000000000",
      timestamp: 1_700_000_000_000,
    });
  });

  test("omits fields the indexer can't derive (matcher fills later)", () => {
    const row = buildMatchSettledRow(
      {
        marketId,
        maker,
        taker,
        fillSizeE18: 1n,
        fillPriceE18: 1n,
      },
      baseMeta,
    );
    // These columns exist in the datasource but Ponder can't populate
    // them — the matcher keeper owns the full row. Verify they're
    // absent so we don't accidentally ship "0" / "" garbage.
    expect(row).not.toHaveProperty("side");
    expect(row).not.toHaveProperty("takerIntentId");
    expect(row).not.toHaveProperty("makerIntentId");
    expect(row).not.toHaveProperty("notionalUsdc");
    expect(row).not.toHaveProperty("feeUsdc");
    expect(row).not.toHaveProperty("takerPnl");
    expect(row).not.toHaveProperty("makerPnl");
  });
});

describe("buildPositionIncreasedRow", () => {
  test("long open — sign(sizeDelta) > 0 → side=long, deltaKind=increase, realizedPnl=0", () => {
    const row = buildPositionIncreasedRow(
      {
        marketId,
        trader: taker,
        sizeDeltaE18: 5_000_000_000_000_000_000n,
        resultingSizeE18: 5_000_000_000_000_000_000n,
        entryPriceE18: 1_080_000_000_000_000_000n,
        marginReserved: 100_000_000n,
        fee: 50_000n,
      },
      baseMeta,
    );
    expect(row.deltaKind).toBe("increase");
    expect(row.side).toBe("long");
    expect(row.sizeDelta).toBe("5000000000000000000");
    expect(row.newSize).toBe("5000000000000000000");
    expect(row.entryPriceE18).toBe("1080000000000000000");
    expect(row.realizedPnl).toBe("0");
    expect(row.eventId).toBe(`${txHash}-${baseMeta.logIndex}`);
  });

  test("short open — sign(sizeDelta) < 0 → side=short", () => {
    const row = buildPositionIncreasedRow(
      {
        marketId,
        trader: taker,
        sizeDeltaE18: -3_000_000_000_000_000_000n,
        resultingSizeE18: -3_000_000_000_000_000_000n,
        entryPriceE18: 1_080_000_000_000_000_000n,
        marginReserved: 60_000_000n,
        fee: 50_000n,
      },
      baseMeta,
    );
    expect(row.side).toBe("short");
    expect(row.sizeDelta).toBe("-3000000000000000000");
    expect(row.newSize).toBe("-3000000000000000000");
  });
});

describe("buildPositionDecreasedRow", () => {
  test("closing a long — sizeDelta < 0 → side=long (held side, not close direction)", () => {
    const row = buildPositionDecreasedRow(
      {
        marketId,
        trader: taker,
        sizeDeltaE18: -1_000_000_000_000_000_000n,
        resultingSizeE18: 4_000_000_000_000_000_000n,
        priceE18: 1_090_000_000_000_000_000n,
        marginReleased: 20_000_000n,
        pnl: 5_000_000n,
        badDebt: 0n,
      },
      baseMeta,
    );
    expect(row.deltaKind).toBe("decrease");
    expect(row.side).toBe("long");
    expect(row.sizeDelta).toBe("-1000000000000000000");
    expect(row.newSize).toBe("4000000000000000000");
    expect(row.entryPriceE18).toBe("1090000000000000000");
    expect(row.realizedPnl).toBe("5000000");
  });

  test("closing a short — sizeDelta > 0 → side=short", () => {
    const row = buildPositionDecreasedRow(
      {
        marketId,
        trader: taker,
        sizeDeltaE18: 1_000_000_000_000_000_000n,
        resultingSizeE18: -2_000_000_000_000_000_000n,
        priceE18: 1_070_000_000_000_000_000n,
        marginReleased: 20_000_000n,
        pnl: -1_000_000n,
        badDebt: 0n,
      },
      baseMeta,
    );
    expect(row.side).toBe("short");
    expect(row.realizedPnl).toBe("-1000000");
  });

  test("negative realized PnL serialises with leading minus", () => {
    const row = buildPositionDecreasedRow(
      {
        marketId,
        trader: taker,
        sizeDeltaE18: -1n,
        resultingSizeE18: 0n,
        priceE18: 1n,
        marginReleased: 0n,
        pnl: -42n,
        badDebt: 0n,
      },
      baseMeta,
    );
    expect(row.realizedPnl).toBe("-42");
  });
});

describe("buildTradeMessage", () => {
  test("matches the PR #56 TradeMessage wire shape", () => {
    const msg = buildTradeMessage({
      fillPriceE18: 1_080_000_000_000_000_000n,
      fillSizeE18: 1_000_000_000_000_000_000n,
      side: "long",
      txHash,
      taker,
      blockTimestamp: 1_700_000_000n,
    });
    expect(msg).toEqual({
      priceE18: "1080000000000000000",
      sizeE18: "1000000000000000000",
      side: "long",
      txHash: txHash.toLowerCase(),
      taker: taker.toLowerCase(),
      ts: 1_700_000_000_000,
    });
  });
});
