import { describe, expect, test } from "bun:test";

import { ARC_PERP_MARKETS, CONTRACTS, loadContracts } from "./index";

describe("contract address registry", () => {
  test("includes the Arc sprint-1 perp stack (2026-05-21 broadcast)", () => {
    expect(CONTRACTS[5042002].perps).toMatchObject({
      clearinghouse: "0x7707d108F6Ce3d95ceA38D3965448F00C21CaFdC",
      marginAccount: "0x77BBAef17257AD4800BE12A5D36AF87f3a49FBb7",
      fundingEngine: "0xE08a146B9081A8dd32203fC5e7B5988352489518",
      healthChecker: "0x234E06a0761cde322E4Fc5065A8256247669F362",
      liquidationEngine: "0x18DEA7845c36d45AaDbcCeC04aC6cFc103748D80",
      orderSettlement: "0xCeae7846c8ED2Dd9E6f541798a657875305EA0d8",
    });
  });

  test("includes the configured Arc sprint-1 perp markets (no t-prefix)", () => {
    expect(ARC_PERP_MARKETS).toMatchObject({
      "EURC/USDC": {
        marketId: "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
        config: { initialMarginBps: 500, maintenanceMarginBps: 300, tradingFeeBps: 5 },
      },
      "JPYC/USDC": {
        marketId: "0x848d2b05de70986fa3661af2a50953b537f05066eedc33c18cde1bd12cdd0a2d",
      },
      "MXNB/USDC": {
        marketId: "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
      },
      "CIRBTC/USDC": {
        marketId: "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
      },
    });
  });

  test("accepts the flat deployments/perps-5042002.json shape as an env override", () => {
    const previous = process.env.CONTRACT_ADDRESSES_JSON;
    process.env.CONTRACT_ADDRESSES_JSON = JSON.stringify({
      5042002: {
        FxPerpClearinghouse: "0x1111111111111111111111111111111111111111",
        FxMarginAccount: "0x2222222222222222222222222222222222222222",
        FxFundingEngine: "0x3333333333333333333333333333333333333333",
        FxHealthChecker: "0x4444444444444444444444444444444444444444",
        FxLiquidationEngine: "0x5555555555555555555555555555555555555555",
        FxOrderSettlement: "0x6666666666666666666666666666666666666666",
      },
    });

    try {
      expect(loadContracts()[5042002].perps).toMatchObject({
        clearinghouse: "0x1111111111111111111111111111111111111111",
        marginAccount: "0x2222222222222222222222222222222222222222",
        fundingEngine: "0x3333333333333333333333333333333333333333",
        healthChecker: "0x4444444444444444444444444444444444444444",
        liquidationEngine: "0x5555555555555555555555555555555555555555",
        orderSettlement: "0x6666666666666666666666666666666666666666",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.CONTRACT_ADDRESSES_JSON;
      } else {
        process.env.CONTRACT_ADDRESSES_JSON = previous;
      }
    }
  });
});
