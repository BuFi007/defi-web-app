import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { decimalPriceString, oracleAgeSeconds } from "@bufi/market-data";
import { liveTelaranaMarkets } from "@bufi/fx-telarana";

import { errorStatus, hermes } from "../services";

// ───────────────────────── schemas ─────────────────────────
// MarketRegistryEntry originates from `@bufi/shared-types` and is shaped by
// `@bufi/fx-telarana`'s `liveTelaranaMarkets()`. We deliberately do NOT
// re-derive the full shape in zod here (would couple this PR to the shared
// type and risk drift). `.passthrough()` preserves every field on the wire;
// the typed BFF client gets the known fields back and any extras stay
// `unknown`-typed but present at runtime — same observable behavior as
// before.
const MarketRegistryEntrySchema = z
  .object({
    marketId: z.string(),
    symbol: z.string(),
    baseAsset: z.string(),
    quoteAsset: z.string(),
    source: z.string(),
    chainId: z.number(),
    enabled: z.boolean(),
  })
  .passthrough()
  .openapi("MarketRegistryEntry");

const MarketsListResponse = z
  .object({ markets: z.array(MarketRegistryEntrySchema) })
  .openapi("MarketsListResponse");

const MarketResponse = z
  .object({ market: MarketRegistryEntrySchema })
  .openapi("MarketResponse");

const ErrorResponse = z
  .object({ error: z.string() })
  .openapi("MarketsErrorResponse");

// `updateData` is the raw hex blob returned by Pyth Hermes and we MUST keep it
// shaped as `0x${string}[]` for downstream contract calls. Other numeric-ish
// fields (`confidence`, `ts`) come back as nullable because Pyth occasionally
// returns no price for a feed and we keep that surface explicit.
const MarketPriceResponse = z
  .object({
    marketId: z.string(),
    source: z.literal("pyth"),
    price: z.string().nullable(),
    confidence: z.union([z.string(), z.number()]).nullable(),
    ts: z.number().nullable(),
    oracleStaleSeconds: z.number().nullable(),
    updateData: z.array(z.string()),
  })
  .openapi("MarketPriceResponse");

// Candles endpoint is currently a placeholder ("source": "not_configured").
// Schema is intentionally permissive so a real candle storage backend can
// land without a coupled schema change.
const MarketCandlesResponse = z
  .object({
    marketId: z.string(),
    candles: z.array(z.unknown()),
    source: z.string(),
    note: z.string().optional(),
  })
  .openapi("MarketCandlesResponse");

// ───────────────────────── routes ─────────────────────────
const listMarketsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["markets"],
  summary: "List live Telarana markets",
  request: {
    query: z.object({
      chainId: z
        .string()
        .optional()
        .openapi({ description: "Filter to a single EVM chain id (e.g. 8453)" }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: MarketsListResponse } },
      description: "All live markets, optionally chain-filtered",
    },
  },
});

const getMarketRoute = createRoute({
  method: "get",
  path: "/{marketId}",
  tags: ["markets"],
  summary: "Get a single market by id",
  request: {
    params: z.object({ marketId: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: MarketResponse } },
      description: "Market found",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Market not found",
    },
  },
});

const getMarketPriceRoute = createRoute({
  method: "get",
  path: "/{marketId}/price",
  tags: ["markets"],
  summary: "Pyth-sourced price + updateData blob for a market",
  request: {
    params: z.object({ marketId: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: MarketPriceResponse } },
      description: "Latest oracle price snapshot",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Market not found",
    },
    // Hermes / oracle failures map to errorStatus(e). The shape is the same
    // ErrorResponse — we just don't enumerate every upstream status here.
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Upstream oracle failure",
    },
  },
});

const getMarketCandlesRoute = createRoute({
  method: "get",
  path: "/{marketId}/candles",
  tags: ["markets"],
  summary: "Candles placeholder (storage owned by indexer)",
  request: {
    params: z.object({ marketId: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: MarketCandlesResponse } },
      description: "Empty candle list until candle storage is wired",
    },
  },
});

// Chain every `.openapi(...)` so the resulting variable type carries the
// full route union. Plain `marketsRoutes.openapi(...)` mutations on a
// pre-declared `new OpenAPIHono()` do NOT refine the static type and would
// surface as `{ }` on the typed client. The chain-capture pattern matches
// how `server.ts` builds `typedApp`.
const marketsRoutes = new OpenAPIHono()
  .openapi(listMarketsRoute, (c) => {
    const raw = c.req.query("chainId");
    const chainId = raw ? Number(raw) : undefined;
    const markets = liveTelaranaMarkets().filter(
      (m) => !chainId || m.chainId === chainId,
    );
    // Cast: MarketRegistryEntry has stricter literal types than the passthrough
    // schema — runtime shape matches, the cast just satisfies the zod inferred
    // output type.
    return c.json({ markets } as z.infer<typeof MarketsListResponse>, 200);
  })
  .openapi(getMarketRoute, (c) => {
    const market = liveTelaranaMarkets().find(
      (m) => m.marketId === c.req.param("marketId"),
    );
    if (!market) return c.json({ error: "market not found" }, 404);
    return c.json({ market } as z.infer<typeof MarketResponse>, 200);
  })
  .openapi(getMarketPriceRoute, async (c) => {
    const marketId = c.req.param("marketId");
    const route = Object.values(SPOT_FX_ROUTES).find(
      (item) => item.routeId === marketId,
    );
    if (!route) return c.json({ error: "market not found" }, 404);
    try {
      const latest = await hermes.latestPriceUpdates([route.pythFeedId]);
      const price = latest.prices[0] ?? null;
      return c.json(
        {
          marketId,
          source: "pyth" as const,
          price: price ? decimalPriceString(price) : null,
          confidence: price?.price.conf ?? null,
          ts: price?.price.publish_time ?? null,
          oracleStaleSeconds: price ? oracleAgeSeconds(price) : null,
          updateData: latest.updateData,
        },
        200,
      );
    } catch (e) {
      // errorStatus() returns a numeric HTTP status — cast to 500 for the
      // typed surface to avoid widening every upstream-status case in zod.
      const status = errorStatus(e);
      return c.json({ error: (e as Error).message }, (status as 500) ?? 500);
    }
  })
  .openapi(getMarketCandlesRoute, (c) =>
    c.json(
      {
        marketId: c.req.param("marketId"),
        candles: [],
        source: "not_configured",
        note: "candle storage is owned by the indexer/read-store adapter",
      },
      200,
    ),
  );

export { marketsRoutes };
