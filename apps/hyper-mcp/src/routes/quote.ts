import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { livePerpsMarkets } from "@bufi/perps";

function resolveMarketId(symbol: string): string | null {
  const markets = livePerpsMarkets(5042002);
  return markets.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase())?.marketId ?? null;
}

const SYMBOL_ENUM = ["EURC/USDC", "tJPYC/USDC", "MXNB/USDC", "CIRBTC/USDC", "AUDF/USDC"] as const;

const perpQuote = route
  .post("/quote")
  .body(
    z.object({
      symbol: z.enum(SYMBOL_ENUM).optional(),
      marketId: z.string().optional(),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100).default(1),
    }),
  )
  .meta({
    mcp: {
      title: "Perp Quote",
      description:
        "Get a real-time quote for a forex perp trade. Pass human-readable symbol (e.g. 'EURC/USDC') or marketId. Returns mark price (Pyth oracle), trading fee, required margin, and max leverage. Defaults: leverage=1, orderType=market.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = body.marketId ?? (body.symbol ? resolveMarketId(body.symbol) : null);
    if (!marketId) return ok({ error: "Provide symbol (e.g. 'EURC/USDC') or marketId" });
    const quote = await perpsService.quote({
      chainId: 5042002,
      marketId,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
    });
    return ok(jsonSafe({ symbol: body.symbol, resolvedMarketId: marketId, ...quote }));
  });

const costEstimate = route
  .post("/cost")
  .body(
    z.object({
      symbol: z.enum(SYMBOL_ENUM),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(100).default(1),
    }),
  )
  .meta({
    mcp: {
      title: "Cost Estimate",
      description:
        "Pre-flight cost estimation for a perp trade. Returns margin, fee, x402 fee, estimated gas, and total cost in USDC. Use before trading to verify sufficient balance.",
    },
  })
  .handle(async ({ body }) => {
    const marketId = resolveMarketId(body.symbol);
    if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });
    const quote = await perpsService.quote({
      chainId: 5042002,
      marketId,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
    });
    const margin = Number(body.sizeUsdc) / body.leverage;
    const feeUsdc = quote.fee ? Number(quote.fee) / 1_000_000 : 0;
    const x402Fee = 0.005;
    const gasCost = 0.01;
    const total = margin + feeUsdc + x402Fee + gasCost;
    return ok({
      symbol: body.symbol,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
      margin: `${margin.toFixed(4)} USDC`,
      fee: `${feeUsdc.toFixed(6)} USDC`,
      x402Fee: `${x402Fee} USDC`,
      gasCost: `~${gasCost} USDC`,
      total: `~${total.toFixed(4)} USDC`,
    });
  });

export default new Hyper({ prefix: "/api" }).use([perpQuote, costEstimate]);
