import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { telaranaService, jsonSafe } from "../services.ts";

const borrowPreview = route
  .post("/borrow/preview")
  .body(
    z.object({
      marketId: z.string().min(1),
      collateralAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
      borrowAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Borrow Preview",
      description:
        "Preview a borrow position: see pool utilization, borrow APY, and health factor before committing. Use to evaluate carry trade economics or collateral efficiency.",
    },
  })
  .handle(async ({ body }) => {
    const preview = await telaranaService.borrowQuote({
      chainId: 5042002,
      marketId: body.marketId,
      collateralAmount: body.collateralAmount,
      borrowAmount: body.borrowAmount,
    });
    return ok(jsonSafe(preview));
  });

export default new Hyper({ prefix: "/api" }).use([borrowPreview]);
