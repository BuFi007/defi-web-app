import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID } from "../shared.ts";

/** Funding settles on a fixed 8-hour cadence. */
const FUNDING_INTERVAL_SECONDS = 8 * 60 * 60;

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
        "Get current funding rates across all forex perp markets. Each row: { at (unix seconds), bps (funding rate in basis points; positive = longs pay shorts, negative = shorts pay longs) }. Funding settles every 8 hours; `fundingIntervalSeconds` and `nextFundingTime` (unix seconds) give the schedule. An empty `funding` array means no funding has accrued yet (e.g. low/zero open interest on testnet) — it is NOT an error.",
    },
  })
  .output(
    z.object({
      funding: z.array(z.object({ at: z.number(), bps: z.number() })),
      fundingIntervalSeconds: z.number(),
      nextFundingTime: z.number(),
      note: z.string().optional(),
    }),
  )
  .handle(async () => {
    const funding = await perpsService.funding(ARC_CHAIN_ID);
    const now = Math.floor(Date.now() / 1000);
    const nextFundingTime =
      (Math.floor(now / FUNDING_INTERVAL_SECONDS) + 1) * FUNDING_INTERVAL_SECONDS;
    return ok(
      jsonSafe({
        funding,
        fundingIntervalSeconds: FUNDING_INTERVAL_SECONDS,
        nextFundingTime,
        ...(funding.length === 0 && {
          note: "No funding has accrued yet (low/zero open interest). Sign convention: positive bps = longs pay shorts.",
        }),
      }),
    );
  });

export default new Hyper({ prefix: "/api" }).use([listMarkets, fundingRates]);
