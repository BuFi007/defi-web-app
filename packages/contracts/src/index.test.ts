import { describe, expect, test } from "bun:test";

import { ARC_PERP_MARKETS, CONTRACTS, loadContracts } from "./index";

describe("contract address registry", () => {
  test("includes the Arc sprint-1 perp stack (2026-05-21 broadcast)", () => {
    expect(CONTRACTS[5042002].perps).toMatchObject({
      clearinghouse: "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A",
      marginAccount: "0x4EB6018F988301417B93cb2b8899D74D42273e96",
      fundingEngine: "0x859bA11A3693895f8B03C31C6AE3b8F04992115B",
      healthChecker: "0xA00Be167609c02F3879138dA8530BC31527c02b8",
      liquidationEngine: "0xF579e265EF1D5E67EfDbb1F20863465E94a9d3eA",
      orderSettlement: "0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC",
    });
  });

  test("includes the configured Arc sprint-1 perp markets (no t-prefix)", () => {
    expect(ARC_PERP_MARKETS).toMatchObject({
      "EURC/USDC": {
        marketId: "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
        config: { initialMarginBps: 500, maintenanceMarginBps: 300, tradingFeeBps: 5 },
      },
      "tJPYC/USDC": {
        marketId: "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
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
