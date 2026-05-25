import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";

const perpQuote = route
  .post("/quote")
  .body(
    z.object({
      marketId: z.string().min(1),
      side: z.enum(["long", "short"]),
      sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      leverage: z.number().int().min(1).max(50),
    }),
  )
  .meta({
    mcp: {
      title: "Perp Quote",
      description:
        "Get a real-time quote for a forex perpetual futures trade. Returns mark price (Pyth oracle), trading fee, required margin, and max leverage. Use bufi_list_markets first to get valid marketId values.",
    },
  })
  .handle(async ({ body }) => {
    const quote = await perpsService.quote({
      chainId: 5042002,
      marketId: body.marketId,
      side: body.side,
      sizeUsdc: body.sizeUsdc,
      leverage: body.leverage,
    });
    return ok(jsonSafe(quote));
  });

export default new Hyper({ prefix: "/api" }).use([perpQuote]);
