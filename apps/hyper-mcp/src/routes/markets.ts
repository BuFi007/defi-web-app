import { Hyper, ok, route } from "@hyper/core";
import { perpsService, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID } from "../shared.ts";

const listMarkets = route
  .get("/markets")
  .meta({
    mcp: {
      title: "List Markets",
      description:
        "List available forex perpetual futures markets on Arc with current oracle prices and funding rates. Markets: EURC/USDC, JPYC/USDC, MXNB/USDC, CIRBTC/USDC, AUDF/USDC.",
    },
  })
  .handle(async () => {
    const markets = await perpsService.listMarkets(ARC_CHAIN_ID);
    return ok(jsonSafe({ markets }));
  });

const fundingRates = route
  .get("/funding")
  .meta({
    mcp: {
      title: "Funding Rates",
      description:
        "Get current funding rates across all forex perp markets. Positive = longs pay shorts, negative = shorts pay longs. Updated every 8 hours.",
    },
  })
  .handle(async () => {
    const funding = await perpsService.funding(ARC_CHAIN_ID);
    return ok(jsonSafe({ funding }));
  });

export default new Hyper({ prefix: "/api" }).use([listMarkets, fundingRates]);
