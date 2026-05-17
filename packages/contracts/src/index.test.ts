import { describe, expect, test } from "bun:test";

import { ARC_PERP_MARKETS, CONTRACTS, loadContracts } from "./index";

describe("contract address registry", () => {
  test("includes the Arc Phase B-E perp stack", () => {
    expect(CONTRACTS[5042002].perps).toMatchObject({
      clearinghouse: "0x25cDf2ad4Fd446e85273c4D7C77a03F22C742865",
      marginAccount: "0x1869D0253286dF29ce0AB8d29207772C7fD9dc35",
      fundingEngine: "0x725822e8BC6edbcBa52914149e25f2671290C6D2",
      healthChecker: "0x9cc0D71e2Af1532e74C2Af8aE7248ACB501039d5",
      liquidationEngine: "0x01f71c1E74350633bBC9d554ca35DA40412DCFB7",
      orderSettlement: "0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565",
    });
  });

  test("includes the configured Arc Phase B-E perp markets", () => {
    expect(ARC_PERP_MARKETS).toMatchObject({
      "EURC/USDC": {
        marketId: "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
        config: { initialMarginBps: 500, maintenanceMarginBps: 300, tradingFeeBps: 5 },
      },
      "tJPYC/USDC": {
        marketId: "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
      },
      "tMXNB/USDC": {
        marketId: "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
      },
      "tCHFC/USDC": {
        marketId: "0x992a2a93cd7a43a9ca827907f708a00ef88e9757e8aadab780ec4f58b161c7dd",
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
