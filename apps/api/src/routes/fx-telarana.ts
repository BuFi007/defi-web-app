/**
 * fx-telarana HTTP surface.
 *
 * Replaces the prior 501 stubs with handlers that drive the real SDK:
 * markets, oracle, positions, intent typed-data builders, and verification.
 * Intents are stored in-memory in @bufi/fx-telarana — durable persistence is
 * the keeper's job, not the API's.
 */
import { Hono, type Context } from "hono";
import type { z } from "zod";

import {
  WAD,
  addressSchema,
  aggregateTvl,
  borrowIntentSchema,
  buildBorrowIntent,
  buildRepayIntent,
  buildSupplyCollateralIntent,
  buildSupplyIntent,
  buildWithdrawCollateralIntent,
  buildWithdrawIntent,
  collateralIntentSchema,
  ensureMarketState,
  getAccountPosition,
  getIntent,
  getMarketById,
  getMarketByPair,
  getNextIntentNonce,
  hubChainIdSchema,
  intentActionSchema,
  intentSignatureSchema,
  liquidationCandidatesQuerySchema,
  listAccountPositions,
  listMarkets,
  marketIdSchema,
  marketRefSchema,
  quoteBorrow,
  quoteBorrowSchema,
  quoteRepay,
  quoteRepaySchema,
  quoteSupply,
  quoteSupplySchema,
  quoteWithdraw,
  quoteWithdrawSchema,
  readMarketOracleQuote,
  repayIntentSchema,
  storeIntent,
  stringifyBalances,
  supplyIntentSchema,
  verifyStoredIntent,
  withdrawIntentSchema,
  type FxTelaranaAction,
  type FxTelaranaIntentTypedData,
} from "@bufi/fx-telarana";
import type { WalletSession } from "@bufi/shared-types";

import { errorStatus } from "../services";

const fxTelaranaRoutes = new Hono();

function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function jsonRes(c: Context, value: unknown, status = 200) {
  return c.newResponse(JSON.stringify(value, replacer), status as 200, {
    "content-type": "application/json; charset=utf-8",
  });
}

async function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  c: Context,
): Promise<z.output<TSchema>> {
  const body = await c.req.json().catch(() => ({}));
  return schema.parse(body);
}

function requireSession(c: Context): WalletSession {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) {
    throw Object.assign(new Error("wallet session required"), { __status: 401 });
  }
  return session;
}

function asStatus(error: unknown): number {
  const anyErr = error as { __status?: number; status?: number; code?: string };
  return anyErr?.__status ?? anyErr?.status ?? errorStatus(error);
}

function reportError(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  return c.json({ error: message, ...(code ? { code } : {}) }, asStatus(error) as 400);
}

// ────────────────────────────── markets ────────────────────────────────────

fxTelaranaRoutes.get("/markets", async (c) => {
  try {
    return jsonRes(c, { markets: await listMarkets() });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.get("/markets/:hubChainId/:marketId", async (c) => {
  try {
    const ref = marketRefSchema.parse({
      hubChainId: Number(c.req.param("hubChainId")),
      marketId: c.req.param("marketId"),
    });
    const market = await getMarketById(ref);
    if (!market) return c.json({ error: "market_not_found" }, 404);
    return jsonRes(c, { market });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.get("/markets/:hubChainId/:marketId/oracle", async (c) => {
  try {
    const ref = marketRefSchema.parse({
      hubChainId: Number(c.req.param("hubChainId")),
      marketId: c.req.param("marketId"),
    });
    const market = await getMarketById(ref);
    if (!market) return c.json({ error: "market_not_found" }, 404);
    const oracle = await readMarketOracleQuote({ market });
    return jsonRes(c, {
      ...ref,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      oracleSurface: "FxOracle.getMid",
      midE18: oracle.midE18,
      publishedAt: oracle.publishedAt,
    });
  } catch (error) {
    return reportError(c, error);
  }
});

// ────────────────────────────── positions ──────────────────────────────────

fxTelaranaRoutes.get("/positions/:address", async (c) => {
  try {
    const account = addressSchema.parse(c.req.param("address"));
    const hubChainIdParam = c.req.query("hubChainId");
    const hubChainId = hubChainIdParam
      ? hubChainIdSchema.parse(Number(hubChainIdParam))
      : undefined;
    const positions = await listAccountPositions({
      account,
      ...(hubChainId ? { hubChainId } : {}),
    });
    return jsonRes(c, {
      address: account,
      source: "onchain_morpho_fx_oracle",
      positions,
    });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.get("/positions/:address/:marketId", async (c) => {
  try {
    const account = addressSchema.parse(c.req.param("address"));
    const marketId = marketIdSchema.parse(c.req.param("marketId"));
    const hubChainId = c.req.query("hubChainId")
      ? hubChainIdSchema.parse(Number(c.req.query("hubChainId")))
      : undefined;
    if (!hubChainId) return c.json({ error: "hubChainId query required" }, 400);
    const position = await getAccountPosition({ account, hubChainId, marketId });
    if (!position) return c.json({ error: "position_market_not_found" }, 404);
    return jsonRes(c, { address: account, marketId, position });
  } catch (error) {
    return reportError(c, error);
  }
});

// ────────────────────────────── quotes ─────────────────────────────────────

async function borrowQuotePayload(body: z.output<typeof quoteBorrowSchema>) {
  const market = await getMarketByPair(body);
  if (!market) return null;
  const [state, oracle, existingPosition] = await Promise.all([
    ensureMarketState({ market }),
    readMarketOracleQuote({ market }),
    body.account
      ? getAccountPosition({
          account: body.account,
          hubChainId: market.hubChainId,
          marketId: market.id,
        })
      : Promise.resolve(null),
  ]);
  const quote = quoteBorrow({
    market: { ...market, state },
    collateral: (existingPosition?.collateral ?? 0n) + body.collateral,
    borrowAmount: body.borrowAmount,
    ...(existingPosition ? { existingBorrowShares: existingPosition.borrowShares } : {}),
    totalBorrowAssets: state.totalBorrowAssets,
    totalBorrowShares: state.totalBorrowShares,
    collateralPriceE36: oracle.midE18 * WAD,
  });
  return { ...quote, collateralInput: body.collateral, existingPosition, oracle };
}

fxTelaranaRoutes.post("/supply/quote", async (c) => {
  try {
    const body = await parseBody(quoteSupplySchema, c);
    const market = await getMarketByPair(body);
    if (!market) return c.json({ error: "market_not_found" }, 404);
    const state = await ensureMarketState({ market });
    return jsonRes(c, {
      marketId: market.id,
      ...quoteSupply({
        assets: body.assets,
        totalSupplyAssets: state.totalSupplyAssets,
        totalSupplyShares: state.totalSupplyShares,
      }),
    });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.post("/borrow/quote", async (c) => {
  try {
    const body = await parseBody(quoteBorrowSchema, c);
    const payload = await borrowQuotePayload(body);
    if (!payload) return c.json({ error: "market_not_found" }, 404);
    return jsonRes(c, payload);
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.post("/repay/quote", async (c) => {
  try {
    const body = await parseBody(quoteRepaySchema, c);
    const market = await getMarketByPair(body);
    if (!market) return c.json({ error: "market_not_found" }, 404);
    const state = await ensureMarketState({ market });
    return jsonRes(c, {
      marketId: market.id,
      ...quoteRepay({
        assets: body.assets,
        totalBorrowAssets: state.totalBorrowAssets,
        totalBorrowShares: state.totalBorrowShares,
      }),
    });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.post("/withdraw/quote", async (c) => {
  try {
    const body = await parseBody(quoteWithdrawSchema, c);
    const market = await getMarketByPair(body);
    if (!market) return c.json({ error: "market_not_found" }, 404);
    const state = await ensureMarketState({ market });
    return jsonRes(c, {
      marketId: market.id,
      ...quoteWithdraw({
        shares: body.shares,
        totalSupplyAssets: state.totalSupplyAssets,
        totalSupplyShares: state.totalSupplyShares,
      }),
    });
  } catch (error) {
    return reportError(c, error);
  }
});

// ────────────────────────────── intents ────────────────────────────────────

fxTelaranaRoutes.get("/intents/nonce/:hubChainId/:action/:address", (c) => {
  try {
    const chainId = hubChainIdSchema.parse(Number(c.req.param("hubChainId")));
    const action = intentActionSchema.parse(c.req.param("action"));
    const account = addressSchema.parse(c.req.param("address"));
    return jsonRes(c, {
      hubChainId: chainId,
      action,
      account,
      nextNonce: getNextIntentNonce({ chainId, action, account }),
    });
  } catch (error) {
    return reportError(c, error);
  }
});

// Helper: assert the session wallet matches the on-behalf address declared
// in the intent body. The keeper would otherwise be able to mint an intent
// for any account.
function assertOnBehalfMatchesSession(session: WalletSession, onBehalf: string) {
  if (session.address.toLowerCase() !== onBehalf.toLowerCase()) {
    throw Object.assign(new Error("onBehalf must match session address"), { __status: 403 });
  }
}

function registerIntentRoutes<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  kind: FxTelaranaAction,
  build: (body: z.output<TSchema>) => FxTelaranaIntentTypedData,
) {
  fxTelaranaRoutes.post(`/${path}/intents`, async (c) => {
    try {
      const session = requireSession(c);
      const body = await parseBody(schema, c);
      assertOnBehalfMatchesSession(session, (body as { onBehalf: string }).onBehalf);
      return jsonRes(c, storeIntent(kind, build(body)), 201);
    } catch (error) {
      return reportError(c, error);
    }
  });
  fxTelaranaRoutes.get(`/${path}/intents/:id`, (c) => {
    const intent = getIntent(c.req.param("id"));
    return intent ? jsonRes(c, intent) : c.json({ error: "intent_not_found" }, 404);
  });
  fxTelaranaRoutes.post(`/${path}/intents/:id/signature`, async (c) => {
    try {
      const body = await parseBody(intentSignatureSchema, c);
      return jsonRes(c, await verifyStoredIntent(c.req.param("id"), body));
    } catch (error) {
      return reportError(c, error);
    }
  });
}

registerIntentRoutes("supply", supplyIntentSchema, "Supply", (body) =>
  buildSupplyIntent({ chainId: body.hubChainId, ...body }),
);
registerIntentRoutes("borrow", borrowIntentSchema, "Borrow", (body) =>
  buildBorrowIntent({ chainId: body.hubChainId, ...body }),
);
registerIntentRoutes("repay", repayIntentSchema, "Repay", (body) =>
  buildRepayIntent({ chainId: body.hubChainId, ...body }),
);
registerIntentRoutes("withdraw", withdrawIntentSchema, "Withdraw", (body) =>
  buildWithdrawIntent({ chainId: body.hubChainId, ...body }),
);
registerIntentRoutes(
  "collateral/supply",
  collateralIntentSchema,
  "SupplyCollateral",
  (body) => buildSupplyCollateralIntent({ chainId: body.hubChainId, ...body }),
);
registerIntentRoutes(
  "collateral/withdraw",
  collateralIntentSchema,
  "WithdrawCollateral",
  (body) => buildWithdrawCollateralIntent({ chainId: body.hubChainId, ...body }),
);

// ────────────────────────────── liquidations / tvl ─────────────────────────

fxTelaranaRoutes.get("/liquidations/candidates", async (c) => {
  try {
    const query = liquidationCandidatesQuerySchema.parse({
      hubChainId: c.req.query("hubChainId") ? Number(c.req.query("hubChainId")) : undefined,
      marketId: c.req.query("marketId"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });
    // Without an indexer the API returns an empty list — keeper-runtime is the
    // canonical source of liquidation candidates.
    return jsonRes(c, { ...query, source: "indexer_unconfigured", candidates: [] });
  } catch (error) {
    return reportError(c, error);
  }
});

fxTelaranaRoutes.get("/tvl", async (c) => {
  try {
    const breakdown = aggregateTvl(await listMarkets());
    return jsonRes(c, {
      tvl: stringifyBalances(breakdown.netSupply),
      borrowed: stringifyBalances(breakdown.borrowed),
    });
  } catch (error) {
    return reportError(c, error);
  }
});

export { fxTelaranaRoutes };
