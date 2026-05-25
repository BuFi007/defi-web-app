import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID, zSymbol, zSide, zAmount, zLeverage, resolveMarketId, computeSizeDelta } from "../shared.ts";

const perpQuote = route
  .post("/quote")
  .body(
    z.object({
      symbol: zSymbol.optional(),
      marketId: z.string().optional(),
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
    }),
  )
  .meta({
    mcp: {
      title: "Perp Quote",
      description:
        "Get a real-time quote for a forex perp trade. Pass human-readable symbol (e.g. 'EURC/USDC') or marketId. Returns mark price, trading fee, required margin, and max leverage.",
    },
  })
  .handle(async ({ body }) => {
    try {
      const marketId = body.marketId ?? (body.symbol ? resolveMarketId(body.symbol) : null);
      if (!marketId) return ok({ error: "Provide symbol (e.g. 'EURC/USDC') or marketId" });

      const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);
      const quote = await perpsService.quote({
        chainId: ARC_CHAIN_ID,
        marketId,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: body.leverage,
      });
      return ok(jsonSafe({ symbol: body.symbol, resolvedMarketId: marketId, ...quote }));
    } catch (e) {
      const msg = (e as Error).message;
      return ok({ error: msg });
    }
  });

const costEstimate = route
  .post("/cost")
  .body(
    z.object({
      symbol: zSymbol,
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
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
    try {
      const marketId = resolveMarketId(body.symbol);
      if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

      const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);
      const quote = await perpsService.quote({
        chainId: ARC_CHAIN_ID,
        marketId,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: body.leverage,
      });

      const margin = Number(body.sizeUsdc) / body.leverage;
      const feeUsdc = quote.fee ? Number(quote.fee) / 1_000_000 : 0;
      const x402Fee = 0.005;
      const gasCost = 0.01;
      return ok({
        symbol: body.symbol,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        leverage: body.leverage,
        margin: `${margin.toFixed(4)} USDC`,
        fee: `${feeUsdc.toFixed(6)} USDC`,
        x402Fee: `${x402Fee} USDC`,
        gasCost: `~${gasCost} USDC`,
        total: `~${(margin + feeUsdc + x402Fee + gasCost).toFixed(4)} USDC`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      return ok({ error: msg });
    }
  });

export default new Hyper({ prefix: "/api" }).use([perpQuote, costEstimate]);
