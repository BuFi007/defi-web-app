/**
 * Perps event handlers — owned by feature/perps-backend-final.
 *
 * Wire each event after the Perps contract address + ABI are
 * registered in ponder.config.ts. Pattern:
 *
 *   import { ponder } from "ponder:registry";
 *   import { perpsPosition, perpsMarket } from "../../ponder.schema";
 *
 *   ponder.on("Perps:PositionOpened", async ({ event, context }) => {
 *     await context.db.insert(perpsPosition).values({
 *       positionId: event.args.positionId,
 *       trader: event.args.trader,
 *       marketId: event.args.marketId,
 *       side: event.args.side === 0 ? "long" : "short",
 *       sizeUsdc: event.args.sizeUsdc,
 *       leverage: Number(event.args.leverage),
 *       entryPrice: event.args.entryPrice,
 *       openedAt: event.block.timestamp,
 *     });
 *   });
 *
 *   ponder.on("Perps:PositionClosed", ...);
 *   ponder.on("Perps:MarketRegistered", ...);
 *   ponder.on("Perps:FundingPaid", ...);
 *
 * Until then, this file exports nothing so `ponder dev` boots clean.
 */

export {};
