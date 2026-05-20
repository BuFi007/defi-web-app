/**
 * Poll an open position's PnL by re-reading `/perps/positions/:address`
 * every 5s. For a sub-second feed, subscribe to the WebSocket endpoint
 * `/ws/markets/:marketId` instead.
 */

// In a consumer project: import { … } from "@bufi/sdk";
import {
  ARC_PERP_MARKETS,
  createBufiClient,
  getMarkPrice,
  getPositions,
} from "../src";
import type { Address } from "viem";

async function main(): Promise<void> {
  const bufi = createBufiClient({
    apiUrl: process.env.BUFI_API_URL ?? "https://api.bu.finance",
    chainId: 5042002,
  });

  const trader = process.env.TRADER_ADDRESS as Address;
  if (!trader) throw new Error("set TRADER_ADDRESS");

  const market = ARC_PERP_MARKETS["EURC/USDC"];

  while (true) {
    const [{ positions }, mark] = await Promise.all([
      getPositions(bufi, trader),
      getMarkPrice(bufi, market.marketId),
    ]);
    const pos = positions.find((p) => p.marketId.toLowerCase() === market.marketId.toLowerCase());
    console.log({
      ts: new Date().toISOString(),
      markPrice: mark.price,
      ageSeconds: mark.ageSeconds,
      sizeDeltaE18: pos?.sizeDeltaE18 ?? "0",
      unrealizedPnl: pos?.unrealizedPnl ?? "—",
    });
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
