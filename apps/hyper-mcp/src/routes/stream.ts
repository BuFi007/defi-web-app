import { Hyper } from "@hyper/core";
import { subscribe } from "@hyper/subscribe";
import { perpsService, tradingDb, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID, resolveMarketId, computeSizeDelta } from "../shared.ts";
import { livePerpsMarkets } from "@bufi/perps";

const priceStream = subscribe<unknown>(
  "/stream/prices/:symbol",
  async function* ({ req, signal }) {
    const url = new URL(req.url);
    const symbol = decodeURIComponent(url.pathname.split("/").pop() ?? "EURC/USDC");
    const marketId = resolveMarketId(symbol);
    if (!marketId) {
      yield { event: "error", data: { error: `Unknown symbol: ${symbol}` } };
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
  },
  {
    name: "Price Stream",
    description:
      "SSE stream of real-time mark prices for a forex perp market. Subscribe once, receive price updates every 2 seconds. Use symbol like 'EURC/USDC'.",
  },
);

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

export default new Hyper({ prefix: "/api" }).use([priceStream, intentStream]);
