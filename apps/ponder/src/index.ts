/**
 * Event handler registrations live here once contract ABIs land in
 * ./abis and the ponder config references them. Pattern:
 *
 *   import { ponder } from "ponder:registry";
 *   import { arcadeRoom } from "../ponder.schema";
 *
 *   ponder.on("Bento:RoomCreated", async ({ event, context }) => {
 *     await context.db.insert(arcadeRoom).values({
 *       roomId: event.args.roomId,
 *       chainId: context.chain.id,
 *       ...
 *     });
 *   });
 *
 * The scaffold ships empty so `ponder dev` can boot against pglite with
 * no events to index, ready for the first contract.
 */

export {};
