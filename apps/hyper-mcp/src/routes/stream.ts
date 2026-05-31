import { Hyper } from "@hyper/core";
import { subscribe, type SubscribeEvent } from "@hyper/subscribe";
import { perpsService, tradingDb, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID, resolveMarketId, computeSizeDelta } from "../shared.ts";
import { livePerpsMarkets } from "@bufi/perps";

/** All tradable perp symbols on Arc, e.g. ["EURC/USDC", ...]. */
function knownSymbols(): string[] {
  return livePerpsMarkets(ARC_CHAIN_ID).map((m) => m.symbol);
}

/**
 * Resolve the requested price-stream symbol from a Request.
 *
 * Cloudflare (prod edge) drops/normalizes URL-encoded slashes in the PATH,
 * so the `/stream/prices/:symbol` form is unreachable for slash-bearing
 * symbols like "EURC/USDC". Callers should instead use the slash-free
 * query form on `/stream/prices`:
 *   - ?base=EURC&quote=USDC  → "EURC/USDC"
 *   - ?symbol=EURC-USDC      → "EURC/USDC" (hyphen or underscore delimiter)
 *   - ?symbol=EURC/USDC      → "EURC/USDC" (raw, when not edge-normalized)
 *
 * The legacy path form (last segment of the pathname) is still honored for
 * back-compat when no query params are present.
 */
function resolveStreamSymbol(req: Request): string {
  const url = new URL(req.url);
  const params = url.searchParams;
  const base = params.get("base");
  const quote = params.get("quote");
  if (base && quote) {
    return `${base}/${quote}`.toUpperCase();
  }
  const symbolParam = params.get("symbol");
  if (symbolParam) {
    // Normalize hyphen/underscore delimiters to the canonical slash form.
    return symbolParam.replace(/[-_]/g, "/").toUpperCase();
  }
  // Legacy path form: /stream/prices/:symbol (URL-decoded last segment).
  return decodeURIComponent(url.pathname.split("/").pop() ?? "EURC/USDC");
}

/** Shared SSE generator for both the path and query-param price routes. */
async function* priceStreamGenerator({
  req,
  signal,
}: {
  req: Request;
  signal: AbortSignal;
}): AsyncIterable<SubscribeEvent<unknown>> {
  const symbol = resolveStreamSymbol(req);
  const marketId = resolveMarketId(symbol);
  if (!marketId) {
    yield {
      event: "error",
      data: { error: `Unknown symbol: ${symbol}`, validSymbols: knownSymbols() },
    };
    return;
  }
  const sizeDelta = computeSizeDelta("long", "1");
  while (!signal.aborted) {
    try {
      const quote = await perpsService.quote({
        chainId: ARC_CHAIN_ID,
        marketId,
        side: "long",
        sizeUsdc: "1",
        sizeDelta,
        leverage: 1,
      });
      yield {
        event: "price",
        data: jsonSafe({ symbol, resolvedMarketId: marketId, ...quote, ts: Date.now() }),
      };
    } catch (e) {
      yield { event: "error", data: { error: (e as Error).message } };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Legacy path form — kept for back-compat. NOTE: unreachable on the Cloudflare
// edge for slash-bearing symbols (encoded slashes are dropped); prefer the
// query-param route below in prod.
const priceStream = subscribe<unknown>("/stream/prices/:symbol", priceStreamGenerator, {
  name: "Price Stream",
  description:
    "SSE stream of real-time mark prices for a forex perp market. Subscribe once, receive price updates every 2 seconds. Use symbol like 'EURC/USDC'. NOTE: symbols contain a slash, which the prod edge (Cloudflare) drops from the path — use GET /api/stream/prices?base=EURC&quote=USDC instead.",
});

// Cloudflare-safe form — slash-free path, symbol via query params.
const priceStreamQuery = subscribe<unknown>("/stream/prices", priceStreamGenerator, {
  name: "Price Stream (query)",
  description:
    "SSE stream of real-time mark prices for a forex perp market. Slash-free, Cloudflare-safe entry point: pass the market via query params — GET /api/stream/prices?base=EURC&quote=USDC, or GET /api/stream/prices?symbol=EURC-USDC (hyphen/underscore delimiter). Subscribe once, receive price updates every 2 seconds.",
});

const TERMINAL_STATUSES = new Set(["filled", "rejected", "expired"]);
const NOTIFY_STATUSES = new Set(["filled", "rejected", "expired"]);

function marketIdToSymbol(marketId: string): string {
  const markets = livePerpsMarkets(ARC_CHAIN_ID);
  return markets.find((m) => m.marketId === marketId)?.symbol ?? marketId;
}

const intentStream = subscribe<unknown>(
  "/stream/intents/:address",
  async function* ({ req, signal }) {
    const url = new URL(req.url);
    const segments = url.pathname.split("/");
    const address = decodeURIComponent(segments[segments.length - 1] ?? "");
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      yield { event: "error", data: { error: `Invalid address: ${address}` } };
      return;
    }

    // Track known statuses so we only emit on changes
    const knownStatus = new Map<string, string>();

    while (!signal.aborted) {
      try {
        const intents = await tradingDb.perpsIntents.list({ trader: address });
        for (const intent of intents) {
          const prev = knownStatus.get(intent.intentId);
          const status = intent.status;

          // Emit when status changed to a notifiable state, or first seen as accepted (pending)
          if (prev !== status) {
            if (prev === undefined && status === "pending") {
              // First time seeing a pending intent — notify as "accepted"
              knownStatus.set(intent.intentId, status);
              yield {
                event: "accepted",
                data: jsonSafe({
                  intentId: intent.intentId,
                  symbol: marketIdToSymbol(intent.marketId),
                  side: intent.side,
                  sizeUsdc: intent.sizeUsdc,
                  status: "accepted",
                  timestamp: intent.createdAt,
                }),
              };
            } else if (NOTIFY_STATUSES.has(status)) {
              knownStatus.set(intent.intentId, status);
              yield {
                event: status,
                data: jsonSafe({
                  intentId: intent.intentId,
                  symbol: marketIdToSymbol(intent.marketId),
                  side: intent.side,
                  sizeUsdc: intent.sizeUsdc,
                  status,
                  timestamp: intent.updatedAt,
                }),
              };
            } else {
              // Track non-terminal status changes silently
              knownStatus.set(intent.intentId, status);
            }
          }
        }
      } catch (e) {
        yield { event: "error", data: { error: (e as Error).message } };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
  {
    name: "Intent Status Stream",
    description:
      "SSE stream of real-time intent status notifications for a trader address. Emits events when intents are accepted, filled, rejected, or expired. Use the trader's 0x address.",
  },
);

export default new Hyper({ prefix: "/api" }).use([priceStreamQuery, priceStream, intentStream]);
