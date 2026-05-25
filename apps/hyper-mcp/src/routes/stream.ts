import { Hyper } from "@hyper/core";
import { subscribe } from "@hyper/subscribe";
import { perpsService, jsonSafe } from "../services.ts";
import { livePerpsMarkets } from "@bufi/perps";

function resolveMarketId(symbol: string): string | null {
  const markets = livePerpsMarkets(5042002);
  return markets.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase())?.marketId ?? null;
}

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
    while (!signal.aborted) {
      try {
        const quote = await perpsService.quote({
          chainId: 5042002,
          marketId,
          side: "long",
          sizeUsdc: "1",
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

export default new Hyper({ prefix: "/api" }).use([priceStream]);
