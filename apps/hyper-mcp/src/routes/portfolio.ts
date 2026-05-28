import { Hyper, ok, route } from "@hyper/core";
import { perpsService, telaranaService, jsonSafe } from "../services.ts";

// One read for a wallet's holdings across products, replacing the
// perp/lending fan-out an agent previously had to know to do itself.
// Each leg degrades independently: if one source errors, its slot carries an
// `error` string instead of taking down the whole response.
const portfolio = route
  .get("/portfolio/:address")
  .meta({
    mcp: {
      title: "Wallet Portfolio",
      description:
        "Unified read of a wallet's holdings across products: open perpetual-futures positions and lending positions (supplied/borrowed + health factor). One call instead of fanning out across get__api_positions and get__api_lending_positions. Note: spot FX holdings are plain wallet token balances and are not tracked here; ghost/shielded balances are private.",
    },
  })
  .handle(async (ctx) => {
    const address = (ctx.params as Record<string, string>).address ?? "";
    if (!address) return ok({ address: "", perp: [], lending: [] });

    const [perp, lending] = await Promise.all([
      perpsService.listPositions(address).catch((e) => ({ error: String((e as Error).message ?? e) })),
      telaranaService.positionsFor(address).catch((e) => ({ error: String((e as Error).message ?? e) })),
    ]);

    return ok(jsonSafe({
      address,
      perp,
      lending,
      note: "Spot holdings are wallet token balances (read them on-chain). Ghost/shielded balances are private by design.",
    }));
  });

export default new Hyper({ prefix: "/api" }).use([portfolio]);
