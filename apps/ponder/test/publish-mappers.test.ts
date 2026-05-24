/**
 * Unit tests for the Wave F2 publish mappers.
 *
 * Run with `bun test apps/ponder/test/publish-mappers.test.ts`. No
 * Ponder runtime needed — these are pure functions over event args.
 *
 * Lives outside `src/` because Ponder's indexer bundles every `.ts`
 * file under `src/` as a handler entry, which can't resolve `bun:test`.
 * Keeping the tests in `test/` lets the dev boot succeed.
 */
import { describe, expect, test } from "bun:test";

import {
  blockTimestampToMs,
  buildAccountFlaggedRow,
  buildAccountLiquidatedRow,
  buildEventId,
  buildFundingMessage,
  buildFundingPokedRow,
  buildMatchSettledRow,
  buildPositionDecreasedRow,
  buildPositionIncreasedRow,
  buildTradeMessage,
  deltaSign,
  lowerHex,
} from "../src/handlers/_publish-mappers";

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

// ────────────────────────── Wave I1 — FundingPoked ─────────────────────

describe("buildFundingPokedRow", () => {
  test("snake_case columns line up with the perp_funding_poked datasource", () => {
    const row = buildFundingPokedRow(
      {
        marketId,
        version: 42n,
        rateE18PerSecond: 5_000_000_000n,
        cumulativeFundingE18: 1_234_567_890_000_000_000n,
      },
      baseMeta,
    );
    expect(row).toEqual({
      event_id: `${txHash}-${baseMeta.logIndex}`,
      market_id: marketId.toLowerCase(),
      version: "42",
      rate_e18_per_second: "5000000000",
      cumulative_funding_e18: "1234567890000000000",
      chain_id: baseMeta.chainId,
      tx_hash: txHash.toLowerCase(),
      block_number: "12345",
      timestamp: new Date(1_700_000_000_000).toISOString(),
    });
  });

  test("negative rates / cumulative serialise with leading minus", () => {
    const row = buildFundingPokedRow(
      {
        marketId,
        version: 1n,
        rateE18PerSecond: -7n,
        cumulativeFundingE18: -42n,
      },
      baseMeta,
    );
    expect(row.rate_e18_per_second).toBe("-7");
    expect(row.cumulative_funding_e18).toBe("-42");
  });
});

describe("buildFundingMessage", () => {
  test("matches the PR #56 FundingMessage wire shape", () => {
    const msg = buildFundingMessage(
      {
        marketId,
        version: 3n,
        rateE18PerSecond: 2_500_000_000n,
        cumulativeFundingE18: 9_999_999_999_999n,
      },
      baseMeta,
    );
    // markE18 is "0" deliberately — FundingPoked doesn't carry the mark
    // price, and the channel contract requires the field. Downstream
    // consumers join with the oracle stream when they need a real value.
    expect(msg).toEqual({
      rateE18: "2500000000",
      markE18: "0",
      ts: 1_700_000_000_000,
    });
  });
});

// ──────────────────────── Wave I1 — AccountLiquidated ──────────────────

describe("buildAccountLiquidatedRow", () => {
  test("populates the perp_liquidation columns", () => {
    const liquidator = "0xCcCCcCCcCccccccCCCCcCCCCCCccCcCCCcCcCC03";
    const row = buildAccountLiquidatedRow(
      {
        marketId,
        trader: taker,
        liquidator,
        reward: 25_000_000n,
        socializedLoss: 0n,
      },
      baseMeta,
    );
    expect(row).toEqual({
      event_id: `${txHash}-${baseMeta.logIndex}`,
      market_id: marketId.toLowerCase(),
      trader: taker.toLowerCase(),
      liquidator: liquidator.toLowerCase(),
      reward_atomic: "25000000",
      socialized_loss_atomic: "0",
      chain_id: baseMeta.chainId,
      tx_hash: txHash.toLowerCase(),
      block_number: "12345",
      timestamp: new Date(1_700_000_000_000).toISOString(),
    });
  });

  test("negative socialized_loss preserved (insurance pool absorbed surplus)", () => {
    const row = buildAccountLiquidatedRow(
      {
        marketId,
        trader: taker,
        liquidator: maker,
        reward: 0n,
        socializedLoss: -1_000_000n,
      },
      baseMeta,
    );
    expect(row.socialized_loss_atomic).toBe("-1000000");
  });
});

// ───────────────────────── Wave I1 — AccountFlagged ────────────────────

describe("buildAccountFlaggedRow", () => {
  test("produces an idempotent DB row keyed on txHash-logIndex", () => {
    const flagger = "0xDddDDddddDDDDdddddDdDdDDdddDDDddDdDDDD04";
    const row = buildAccountFlaggedRow(
      {
        marketId,
        trader: taker,
        flagger,
      },
      baseMeta,
    );
    expect(row).toEqual({
      id: `${txHash}-${baseMeta.logIndex}`,
      chainId: baseMeta.chainId,
      marketId: marketId.toLowerCase(),
      trader: taker.toLowerCase(),
      state: "flagged",
      actor: flagger.toLowerCase(),
      auto: null,
      blockNumber: 12345n,
      blockTimestamp: 1_700_000_000n,
      txHash: txHash.toLowerCase(),
      logIndex: 7,
    });
  });
});
