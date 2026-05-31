import { Hyper, badRequest, ok, route } from "@hyper/core";
import { perpsService, jsonSafe } from "../services.ts";
import { invalidAddressBody, isEvmAddress } from "./_addr.ts";

const positions = route
  .get("/positions/:address")
  .meta({
    mcp: {
      title: "View Positions",
      description:
        "View all open perpetual futures positions for a wallet address. Returns market, side, size, entry price, mark price, unrealized P&L, and liquidation price.",
    },
  })
  .handle(async (ctx) => {
    const address = (ctx.params as Record<string, string>).address ?? "";
    if (!isEvmAddress(address)) return badRequest(invalidAddressBody(address));
    const list = await perpsService.listPositions(address);
    return ok(jsonSafe({ address, positions: list }));
  });

export default new Hyper({ prefix: "/api" }).use([positions]);
