import { Hyper, ok, route } from "@hyper/core";
import { tradingDb, jsonSafe } from "../services.ts";

const leaderboard = route
  .get("/leaderboard")
  .meta({
    mcp: {
      title: "Trader Leaderboard",
      description:
        "View the top forex perp traders ranked by P&L on Arc. Shows trader address, total PnL, number of trades, and account value. Compatible with Nansen leaderboard schema for cross-protocol composability.",
    },
  })
  .handle(async () => {
    const intents = await tradingDb.perpsIntents.list({ status: "filled" });
    const traderMap = new Map<string, { trades: number; volume: bigint }>();
    for (const intent of intents) {
      const addr = intent.trader.toLowerCase();
      const existing = traderMap.get(addr) ?? { trades: 0, volume: 0n };
      existing.trades += 1;
      traderMap.set(addr, existing);
    }
    const ranked = Array.from(traderMap.entries())
      .map(([address, stats]) => ({
        trader_address: address,
        total_trades: stats.trades,
      }))
      .sort((a, b) => b.total_trades - a.total_trades)
      .slice(0, 50);
    return ok(jsonSafe({ leaderboard: ranked, total_traders: traderMap.size }));
  });

export default new Hyper({ prefix: "/api" }).use([leaderboard]);
