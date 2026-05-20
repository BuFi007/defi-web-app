import { describe, expect, it } from "bun:test";

import {
  mapAccountLiquidatedToPublish,
  mapFundingPokedToPublish,
} from "./_publish-mappers";

const TX_HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;
const MARKET_ID = "0xface000000000000000000000000000000000000000000000000000000000001" as const;

describe("mapFundingPokedToPublish", () => {
  const args = {
    marketId: MARKET_ID,
    version: 7n,
    rateE18PerSecond: 123_456_789n,
    cumulativeFundingE18: -987_654_321n,
  } as const;
  const meta = {
    txHash: TX_HASH,
    blockNumber: 42n,
    logIndex: 3,
  } as const;

  it("emits both realtime + analytics legs", () => {
    const env = mapFundingPokedToPublish(args, meta);
    expect(env.realtime).toBeDefined();
    expect(env.analytics).toBeDefined();
  });

  it("scopes realtime channel per market", () => {
    const env = mapFundingPokedToPublish(args, meta);
    expect(env.realtime?.channel).toBe(`funding:${MARKET_ID}`);
  });

  it("stringifies bigint rate/cumulative on realtime payload", () => {
    const env = mapFundingPokedToPublish(args, meta);
    expect(env.realtime?.payload.rateE18).toBe("123456789");
    expect(env.realtime?.payload.cumulativeFundingE18).toBe("-987654321");
    expect(env.realtime?.payload.version).toBe("7");
    expect(env.realtime?.payload.txHash).toBe(TX_HASH);
    expect(typeof env.realtime?.payload.ts).toBe("number");
  });

  it("builds an event_id of `${txHash}-${logIndex}` for dedupe", () => {
    const env = mapFundingPokedToPublish(args, meta);
    expect(env.analytics?.row.event_id).toBe(`${TX_HASH}-3`);
  });

  it("ships row matching perp_funding_poked schema", () => {
    const env = mapFundingPokedToPublish(args, meta);
    const row = env.analytics?.row ?? {};
    expect(env.analytics?.dataset).toBe("perp_funding_poked");
    expect(row.market_id).toBe(MARKET_ID);
    expect(row.rate_e18).toBe("123456789");
    expect(row.cumulative_funding_e18).toBe("-987654321");
    expect(row.version).toBe("7");
    expect(row.tx_hash).toBe(TX_HASH);
    expect(row.block_number).toBe(42);
    expect(typeof row.timestamp).toBe("string");
    // ISO timestamp shape: 2026-05-20T...Z
    expect(row.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles negative funding rate without precision loss", () => {
    const env = mapFundingPokedToPublish(
      { ...args, rateE18PerSecond: -1234567890123456789n },
      meta,
    );
    expect(env.analytics?.row.rate_e18).toBe("-1234567890123456789");
  });

  it("coerces blockNumber bigint to a JSON-safe Number", () => {
    const env = mapFundingPokedToPublish(args, { ...meta, blockNumber: 12345678n });
    expect(env.analytics?.row.block_number).toBe(12345678);
  });
});

describe("mapAccountLiquidatedToPublish", () => {
  const args = {
    marketId: MARKET_ID,
    trader: "0x1111111111111111111111111111111111111111",
    liquidator: "0x2222222222222222222222222222222222222222",
    reward: 5_000_000n,
    socializedLoss: -1_500_000n,
  } as const;
  const meta = {
    txHash: TX_HASH,
    blockNumber: 99n,
    logIndex: 1,
  } as const;

  it("emits analytics only — no realtime channel for liquidations in v1", () => {
    const env = mapAccountLiquidatedToPublish(args, meta);
    expect(env.realtime).toBeUndefined();
    expect(env.analytics).toBeDefined();
  });

  it("targets the perp_liquidation dataset", () => {
    const env = mapAccountLiquidatedToPublish(args, meta);
    expect(env.analytics?.dataset).toBe("perp_liquidation");
  });

  it("builds an event_id of `${txHash}-${logIndex}` for dedupe", () => {
    const env = mapAccountLiquidatedToPublish(args, meta);
    expect(env.analytics?.row.event_id).toBe(`${TX_HASH}-1`);
  });

  it("ships row matching perp_liquidation schema", () => {
    const env = mapAccountLiquidatedToPublish(args, meta);
    const row = env.analytics?.row ?? {};
    expect(row.market_id).toBe(MARKET_ID);
    expect(row.liquidator).toBe(args.liquidator);
    expect(row.trader).toBe(args.trader);
    expect(row.reward_atomic).toBe("5000000");
    expect(row.socialized_loss_atomic).toBe("-1500000");
    expect(row.tx_hash).toBe(TX_HASH);
    expect(row.block_number).toBe(99);
    expect(typeof row.timestamp).toBe("string");
  });

  it("preserves zero/positive socializedLoss as decimal string", () => {
    const env = mapAccountLiquidatedToPublish({ ...args, socializedLoss: 0n }, meta);
    expect(env.analytics?.row.socialized_loss_atomic).toBe("0");
  });
});
