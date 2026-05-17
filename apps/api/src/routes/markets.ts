import { Hono } from "hono";

import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { decimalPriceString, oracleAgeSeconds } from "@bufi/market-data";
import { liveTelaranaMarkets } from "@bufi/fx-telarana";

import { errorStatus, hermes } from "../services";

const marketsRoutes = new Hono();

marketsRoutes.get("/", (c) => {
  const chainId = c.req.query("chainId") ? Number(c.req.query("chainId")) : undefined;
  const markets = liveTelaranaMarkets().filter((m) => !chainId || m.chainId === chainId);
  return c.json({ markets });
});

marketsRoutes.get("/:marketId", (c) => {
  const market = liveTelaranaMarkets().find((m) => m.marketId === c.req.param("marketId"));
  if (!market) return c.json({ error: "market not found" }, 404);
  return c.json({ market });
});

marketsRoutes.get("/:marketId/price", async (c) => {
  const route = Object.values(SPOT_FX_ROUTES).find((item) => item.routeId === c.req.param("marketId"));
  if (!route) return c.json({ error: "market not found" }, 404);
  try {
    const latest = await hermes.latestPriceUpdates([route.pythFeedId]);
    const price = latest.prices[0] ?? null;
    return c.json({
      marketId: c.req.param("marketId"),
      source: "pyth",
      price: price ? decimalPriceString(price) : null,
      confidence: price?.price.conf ?? null,
      ts: price?.price.publish_time ?? null,
      oracleStaleSeconds: price ? oracleAgeSeconds(price) : null,
      updateData: latest.updateData,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

marketsRoutes.get("/:marketId/candles", (c) =>
  c.json({
    marketId: c.req.param("marketId"),
    candles: [],
    source: "not_configured",
    note: "candle storage is owned by the indexer/read-store adapter",
  }),
);

export { marketsRoutes };
