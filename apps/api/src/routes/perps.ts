import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
  PERPS_REPLACEMENT_NEEDED_EVENT,
  formatAtomicToUsdc,
  perpsIntentRequest,
  perpsQuoteRequest,
  perpsReplacementPrepareRequest,
  perpsReplacementSubmitRequest,
  reconcilePerpsIntentWithSettlements,
} from "@bufi/perps";
import { paymentRequired } from "@bufi/x402";
import {
  compute24hStats,
  fetchBenchmarksHistory,
} from "@bufi/market-data";

import {
  assertAddressMatches,
  getChainIdFromQuery,
  getSession,
  jsonError,
  jsonOk,
  parseBody,
} from "../helpers";
import {
  jsonSafe,
  paymentVerifier,
  perpsService,
  perpsSettlementReader,
  receiptStore,
  tradingDb,
} from "../services";

// UI timeframe ("15m") → Pyth Benchmarks resolution token ("15"). The
// helper in @bufi/market-data accepts the same string; we cap the limit
// here so a misbehaving caller can't request 10k candles.
const MAX_CANDLES = 500;
const DEFAULT_CANDLE_LIMIT = 200;

const perpsRoutes = new Hono();

const sellerForX402 = () =>
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

perpsRoutes.get("/markets", async (c) => {
  const cid = getChainIdFromQuery(c, 5042002);
  if (!cid.ok) return cid.response;
  return c.json({ markets: await perpsService.listMarkets(cid.chainId) });
});

// GET /perps/markets/:sym/candles?tf=15m&limit=200
// Historical OHLCV via Pyth Benchmarks (TradingView UDF shim).
// `:sym` is the UI symbol ("EUR/USD"); the helper maps it to FX.EUR/USD.
// Returns empty `candles` array when the symbol isn't mapped or
// Benchmarks 404s — caller renders empty + the live tail.
perpsRoutes.get("/markets/:sym/candles", async (c) => {
  const sym = decodeURIComponent(c.req.param("sym"));
  const tf = c.req.query("tf") ?? "15m";
  const limitRaw = Number(c.req.query("limit") ?? DEFAULT_CANDLE_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_CANDLES)
    : DEFAULT_CANDLE_LIMIT;
  try {
    const candles = await fetchBenchmarksHistory({
      uiSymbol: sym,
      tf,
      limit,
      baseUrl: process.env.PYTH_BENCHMARKS_URL,
    });
    return jsonOk(c, {
      sym,
      tf,
      source: candles.length ? "pyth-benchmarks" : "empty",
      candles,
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /perps/markets/:sym/stats
// 24h high / low / volume-proxy / change% — derived from the same
// Benchmarks 15m candle stream (cached upstream by Pyth).
perpsRoutes.get("/markets/:sym/stats", async (c) => {
  const sym = decodeURIComponent(c.req.param("sym"));
  try {
    const candles = await fetchBenchmarksHistory({
      uiSymbol: sym,
      tf: "15m",
      limit: 200,
      baseUrl: process.env.PYTH_BENCHMARKS_URL,
    });
    const stats = compute24hStats(candles);
    return jsonOk(c, {
      sym,
      source: candles.length ? "pyth-benchmarks" : "empty",
      ...stats,
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

// GET /perps/intents/pending?marketId=0x...&depth=10
// Returns pending intents grouped by price level (bids = long, asks
// = short). Architecturally honest: this system uses a price-time
// matcher, NOT a CLOB. There's no resting-order book — these are
// signed intents waiting for a counterparty. The UI renders them as
// a book-style view because that's what traders expect to see.
perpsRoutes.get("/intents/pending", async (c) => {
  const marketId = c.req.query("marketId");
  if (!marketId) return c.json({ error: "marketId is required" }, 400);
  const depthRaw = Number(c.req.query("depth") ?? 10);
  const depth = Number.isFinite(depthRaw)
    ? Math.min(Math.max(1, Math.floor(depthRaw)), 50)
    : 10;
  try {
    const now = Math.floor(Date.now() / 1000);
    const all = await tradingDb.perpsIntents.list({ status: "pending" });
    const market = all.filter(
      (i) =>
        i.marketId.toLowerCase() === marketId.toLowerCase() &&
        i.deadline > now,
    );
    // Group by 1e18-scaled limit price. Bucket on price floor so close
    // limit orders coalesce visually. Bucket size = 0.0001 in price
    // terms for FX, derived from priceE18 modulo 1e14.
    const BUCKET_E18 = 100_000_000_000_000n; // 1e14 → 0.0001 in float price
    const bids = new Map<string, { sizeE18: bigint; count: number }>();
    const asks = new Map<string, { sizeE18: bigint; count: number }>();
    for (const i of market) {
      // Skip market orders (priceE18 === 0) — they execute immediately
      // and don't sit in the book.
      const priceE18 = BigInt(i.priceE18 || "0");
      if (priceE18 === 0n) continue;
      const bucket = ((priceE18 / BUCKET_E18) * BUCKET_E18).toString();
      const remaining =
        BigInt(i.remainingSizeDelta || "0") || BigInt(i.sizeDelta || "0");
      const absSize = remaining < 0n ? -remaining : remaining;
      if (absSize === 0n) continue;
      const side = i.side === "long" ? bids : asks;
      const existing = side.get(bucket) ?? { sizeE18: 0n, count: 0 };
      existing.sizeE18 += absSize;
      existing.count += 1;
      side.set(bucket, existing);
    }
    const toLevel = ([priceE18, agg]: [
      string,
      { sizeE18: bigint; count: number },
    ]) => ({
      priceE18,
      sizeE18: agg.sizeE18.toString(),
      count: agg.count,
    });
    // Bids: best (highest price) first. Asks: best (lowest price) first.
    const bidLevels = Array.from(bids.entries())
      .map(toLevel)
      .sort((a, b) => Number(BigInt(b.priceE18) - BigInt(a.priceE18)))
      .slice(0, depth);
    const askLevels = Array.from(asks.entries())
      .map(toLevel)
      .sort((a, b) => Number(BigInt(a.priceE18) - BigInt(b.priceE18)))
      .slice(0, depth);
    return jsonOk(c, {
      marketId,
      depth,
      bids: bidLevels,
      asks: askLevels,
      totalPending: market.length,
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.post("/quote", async (c) => {
  const body = await parseBody(c, perpsQuoteRequest);
  if (!body.ok) return body.response;
  try {
    return jsonOk(c, await perpsService.quote(body.data));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.get("/quote", async (c) => {
  const rawSizeDelta = c.req.query("sizeDelta");
  let inferredSide: "long" | "short" = "long";
  if (rawSizeDelta) {
    try {
      inferredSide = BigInt(rawSizeDelta) < 0n ? "short" : "long";
    } catch {
      return c.json({ error: "sizeDelta must be a signed integer string" }, 400);
    }
  }

  const leverage = Number(c.req.query("leverage") ?? "1");
  const parsed = perpsQuoteRequest.safeParse({
    chainId: Number(c.req.query("chainId") ?? "5042002"),
    marketId: c.req.query("marketId"),
    trader: c.req.query("trader") || undefined,
    side: c.req.query("side") ?? inferredSide,
    sizeUsdc: c.req.query("sizeUsdc") ?? "1",
    sizeDelta: rawSizeDelta,
    leverage,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_quote_query",
        issues: parsed.error.issues,
      },
      400,
    );
  }

  try {
    return jsonOk(c, await perpsService.quote(parsed.data));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.use(
  "/quote/premium",
  paymentRequired({
    toolName: "bufx.quote.perp.premium",
    priceUsdc: "0.0010",
    sellerAddress: sellerForX402(),
    verifier: paymentVerifier,
    receipts: receiptStore,
  }),
);
perpsRoutes.post("/quote/premium", async (c) => {
  const body = await parseBody(c, perpsQuoteRequest);
  if (!body.ok) return body.response;
  try {
    return jsonOk(c, { premium: true, quote: await perpsService.quote(body.data) });
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.post("/intents", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const body = await parseBody(c, perpsIntentRequest);
  if (!body.ok) return body.response;
  const match = assertAddressMatches(c, body.data.trader, s.session);
  if (!match.ok) return match.response;
  try {
    return jsonOk(c, jsonSafe(await perpsService.createIntent(body.data)));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.get("/replacement-needed", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const after = c.req.query("after") ? Number(c.req.query("after")) : undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (after !== undefined && !Number.isFinite(after)) {
    return c.json({ error: "after must be a unix timestamp" }, 400);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }
  const events = await tradingDb.events.list({
    type: PERPS_REPLACEMENT_NEEDED_EVENT,
    actor: s.session.address,
    after,
    limit,
  });
  return c.json(jsonSafe({ events }));
});

// Public, no-auth count endpoint. Lets the web client poll cheaply
// (every 30s) without minting a wallet-session signature first — only
// when count > 0 does the client request a session signature to fetch
// the actual event payloads via the authenticated endpoint above.
//
// SECURITY: returns only a count, no payload data, no PII. The address
// is already public (it's in the URL the caller supplied). Reading the
// number of pending residuals for any address is not sensitive — the
// payloads (which contain order details) remain auth-gated.
perpsRoutes.get("/replacement-needed/count", async (c) => {
  const address = c.req.query("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return c.json({ error: "address must be a 0x-prefixed 20-byte hex" }, 400);
  }
  const events = await tradingDb.events.list({
    type: PERPS_REPLACEMENT_NEEDED_EVENT,
    actor: address.toLowerCase() as `0x${string}`,
    // Cap the read — we only need to know "is it zero or non-zero"
    // for the agent to decide whether to ask for a session signature.
    limit: 50,
  });
  return c.json({ count: events.length });
});

perpsRoutes.post("/intents/:id/replacement/prepare", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const originalIntentId = c.req.param("id");
  const original = await perpsService.getIntent(originalIntentId);
  if (!original) return c.json({ error: "intent not found" }, 404);
  const match = assertAddressMatches(c, original.trader, s.session);
  if (!match.ok) return match.response;
  // originalIntentId is required by the schema but comes from the URL,
  // not the request body. Merge before validation so the body parses
  // cleanly (matches the pre-refactor behaviour the canary expects).
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsReplacementPrepareRequest.safeParse({
    ...(raw as Record<string, unknown>),
    originalIntentId,
  });
  if (!parsed.success) {
    return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  }
  try {
    return jsonOk(c, jsonSafe(await perpsService.prepareReplacementIntent(parsed.data)));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.post("/intents/:id/replacement", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const originalIntentId = c.req.param("id");
  const original = await perpsService.getIntent(originalIntentId);
  if (!original) return c.json({ error: "intent not found" }, 404);
  const match = assertAddressMatches(c, original.trader, s.session);
  if (!match.ok) return match.response;
  // Same URL-param merge pattern as /replacement/prepare above.
  const raw = await c.req.json().catch(() => ({}));
  const parsed = perpsReplacementSubmitRequest.safeParse({
    ...(raw as Record<string, unknown>),
    originalIntentId,
  });
  if (!parsed.success) {
    return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  }
  try {
    return jsonOk(c, jsonSafe(await perpsService.createReplacementIntent(parsed.data)));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.get("/intents/:id/reconciliation", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const intent = await perpsService.getIntent(c.req.param("id"));
  if (!intent) return c.json({ error: "intent not found" }, 404);
  const match = assertAddressMatches(c, intent.trader, s.session);
  if (!match.ok) return match.response;
  const settlementTx = c.req.query("settlementTx")?.toLowerCase();
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }

  try {
    const indexedSettlements = perpsSettlementReader
      ? await perpsSettlementReader.listSettlements({
          chainId: intent.chainId,
          marketId: intent.marketId,
          trader: intent.trader,
          txHash: settlementTx,
          limit,
        })
      : [];
    return c.json(
      jsonSafe({
        indexer: {
          configured: Boolean(perpsSettlementReader),
          settlementTx: settlementTx ?? null,
        },
        reconciliation: reconcilePerpsIntentWithSettlements(intent, indexedSettlements),
      }),
    );
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.get("/intents/:id", async (c) => {
  const intent = await perpsService.getIntent(c.req.param("id"));
  if (!intent) return c.json({ error: "intent not found" }, 404);
  return c.json(jsonSafe({ intent }));
});

// GET /perps/intents/:id/stream — Server-Sent Events feed of status
// transitions for a single intent. Polls perpsService.getIntent() every
// `STATUS_POLL_MS` (1s) and emits a `status` event whenever the status
// field changes (or the filled/remaining magnitudes change). Closes the
// stream when the intent reaches a terminal status (filled / rejected /
// expired) OR when `MAX_STREAM_SECS` elapses (60s) — clients reconnect
// for longer-lived intents. Heartbeat every 15s keeps middlebox
// keepalives happy.
//
// Wire format (one event per transition):
//   event: status
//   data: { "intent_id": "0x...", "status": "filled", "filled_size_delta": "...", "remaining_size_delta": "...", "updated_at": 1234567890 }
//
// On open: a `connected` event with the current snapshot. On 404:
// `not_found` then stream closes. On terminal: `terminal` then stream closes.
perpsRoutes.get("/intents/:id/stream", (c) => {
  const id = c.req.param("id");
  const STATUS_POLL_MS = 1_000;
  const HEARTBEAT_MS = 15_000;
  const MAX_STREAM_SECS = 60;
  return streamSSE(c, async (stream) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let lastSerialised: string | null = null;
    const start = Date.now();
    let lastHeartbeat = start;
    let isTerminal = false;

    const initial = await perpsService.getIntent(id);
    if (!initial) {
      await stream.writeSSE({ event: "not_found", data: JSON.stringify({ intent_id: id }) });
      return;
    }
    lastSerialised = JSON.stringify(jsonSafe(initial));
    await stream.writeSSE({ event: "connected", data: lastSerialised });
    if (isTerminalStatus(initial.status)) {
      await stream.writeSSE({ event: "terminal", data: lastSerialised });
      return;
    }

    while (!stream.aborted) {
      if ((Date.now() - start) / 1000 >= MAX_STREAM_SECS) {
        await stream.writeSSE({ event: "timeout", data: JSON.stringify({ intent_id: id }) });
        return;
      }
      await sleep(STATUS_POLL_MS);
      if (stream.aborted) return;
      const next = await perpsService.getIntent(id);
      if (!next) {
        await stream.writeSSE({ event: "not_found", data: JSON.stringify({ intent_id: id }) });
        return;
      }
      const serialised = JSON.stringify(jsonSafe(next));
      if (serialised !== lastSerialised) {
        await stream.writeSSE({ event: "status", data: serialised });
        lastSerialised = serialised;
      }
      if (isTerminalStatus(next.status)) {
        await stream.writeSSE({ event: "terminal", data: serialised });
        isTerminal = true;
        return;
      }
      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
        lastHeartbeat = Date.now();
      }
    }
    if (!isTerminal) {
      // Client disconnected; nothing more to do.
    }
  });
});

function isTerminalStatus(status: string): boolean {
  return status === "filled" || status === "rejected" || status === "expired";
}

perpsRoutes.get("/positions/:address", async (c) => {
  const s = getSession(c);
  if (!s.ok) return s.response;
  const address = c.req.param("address");
  const match = assertAddressMatches(c, address, s.session, "address");
  if (!match.ok) {
    // Override the default 403 message to preserve the existing wire
    // contract; clients check substring matches for "another wallet".
    return c.json(
      { error: "cannot inspect another wallet's private positions" },
      403,
    );
  }
  return c.json({ address, positions: await perpsService.listPositions(address) });
});

perpsRoutes.get("/trades/:address", async (c) => {
  const address = c.req.param("address");
  if (!perpsSettlementReader) {
    return c.json({ address, trades: [] });
  }
  // Settlements are public on-chain events; unauthenticated reads match
  // the frontend `fetchPerpsTrades` contract (no wallet-session headers).
  const sessionMaybe = getSession(c);
  const sessionChainId = sessionMaybe.ok ? sessionMaybe.session.chainId : undefined;
  const chainId = Number(c.req.query("chainId") ?? sessionChainId ?? 5042002);
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }
  try {
    // Fetch settlements + position events in parallel. Position events
    // carry realized PnL on every `PositionDecreased`; we join them to
    // the settlement rows below so each trade carries its share of the
    // closing PnL. The MVP placeholder side derivation (taker = long)
    // is also replaced here for any settlement that maps to a known
    // `decreased` event, where the pre-close direction is recoverable
    // from `resultingSizeE18` + `sizeDeltaE18`.
    const [rows, positionEvents] = await Promise.all([
      perpsSettlementReader.listSettlements({ chainId, trader: address, limit }),
      perpsSettlementReader.listPositionEvents({ chainId, trader: address, limit }),
    ]);
    const traderLower = address.toLowerCase();

    // Group decreased events by (txHash, marketId) — the smallest key
    // that uniquely identifies a position-close intent — and sum their
    // pnl. A single tx can close across multiple fills; aggregating
    // first lets us split PnL across the matching settlement rows
    // proportionally below.
    const pnlByGroup = new Map<string, bigint>();
    // Track the prevailing side (long vs short closed) per group so
    // settlement rows inherit the real direction instead of the
    // taker/maker placeholder.
    const sideByGroup = new Map<string, "long" | "short">();
    for (const ev of positionEvents) {
      if (ev.kind !== "decreased") continue;
      if (!ev.txHash) continue;
      const key = `${ev.txHash.toLowerCase()}|${ev.marketId.toLowerCase()}`;
      if (ev.pnl != null) {
        const pnlAtomic = BigInt(String(ev.pnl));
        pnlByGroup.set(key, (pnlByGroup.get(key) ?? 0n) + pnlAtomic);
      }
      if (!sideByGroup.has(key)) {
        // Pre-close size = resultingSizeE18 - sizeDeltaE18 (delta is
        // signed and represents the change). Long pre-close → positive,
        // short pre-close → negative.
        const resulting = BigInt(String(ev.resultingSizeE18));
        const delta = BigInt(String(ev.sizeDeltaE18));
        const preClose = resulting - delta;
        sideByGroup.set(key, preClose >= 0n ? "long" : "short");
      }
    }

    // Count settlements per group so we can split the per-group pnl
    // evenly across each fill — every fill in the same tx + market
    // closes part of the same position, so equal split is the honest
    // attribution without a per-fill PnL field on-chain.
    const settlementsPerGroup = new Map<string, number>();
    for (const row of rows) {
      const key = `${(row.txHash ?? "").toLowerCase()}|${row.marketId.toLowerCase()}`;
      settlementsPerGroup.set(key, (settlementsPerGroup.get(key) ?? 0) + 1);
    }

    const trades = rows.map((row) => {
      const fillSizeE18 = String(row.fillSizeE18);
      const fillPriceE18 = String(row.fillPriceE18);
      const groupKey = `${(row.txHash ?? "").toLowerCase()}|${row.marketId.toLowerCase()}`;
      const groupPnl = pnlByGroup.get(groupKey);
      const groupCount = settlementsPerGroup.get(groupKey) ?? 1;
      const isTaker = row.taker.toLowerCase() === traderLower;
      // Prefer the position-event side; fall back to the taker/maker
      // placeholder for settlements with no matching decreased event
      // (i.e. opening fills — `PositionIncreased`, no realized PnL).
      const side: "long" | "short" =
        sideByGroup.get(groupKey) ?? (isTaker ? "long" : "short");
      const sizeAtomic =
        (BigInt(fillSizeE18) * BigInt(fillPriceE18)) /
        1_000_000_000_000_000_000_000_000_000_000n;
      const absAtomic = sizeAtomic < 0n ? -sizeAtomic : sizeAtomic;
      const sizeUsdc = `${(absAtomic / 1_000_000n).toString()}.${(absAtomic % 1_000_000n)
        .toString()
        .padStart(6, "0")}`;
      let realizedPnlUsdc: string | undefined;
      if (groupPnl !== undefined) {
        // Even split across all settlements in the group. Integer
        // division loses sub-µUSDC across the split, which is fine
        // for UI display (the unsplit total is exact at the group
        // level — sum of trades inside the same window recovers it
        // modulo 6-dp truncation).
        const share = groupPnl / BigInt(groupCount);
        realizedPnlUsdc = formatAtomicToUsdc(share);
      }
      return {
        marketId: row.marketId,
        side,
        sizeUsdc,
        priceE18: fillPriceE18,
        fillSizeE18,
        fillPriceE18,
        txHash: row.txHash ?? "0x",
        blockTimestamp: row.blockTimestamp !== undefined ? Number(BigInt(row.blockTimestamp)) : 0,
        realizedPnlUsdc,
      };
    });
    return c.json(jsonSafe({ address, trades }));
  } catch (e) {
    return jsonError(c, e);
  }
});

perpsRoutes.get("/funding", async (c) => {
  const cid = getChainIdFromQuery(c, 5042002);
  if (!cid.ok) return cid.response;
  return c.json({
    funding: await perpsService.funding(cid.chainId, c.req.query("marketId") ?? undefined),
  });
});

perpsRoutes.get("/liquidations/candidates", async (c) => {
  const cid = getChainIdFromQuery(c, 5042002);
  if (!cid.ok) return cid.response;
  return c.json(
    jsonSafe({ candidates: await perpsService.liquidationCandidates(cid.chainId) }),
  );
});

export { perpsRoutes };
