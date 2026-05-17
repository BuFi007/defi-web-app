/**
 * @bufi/fx-bento — domain layer for the FX² Arcade backend.
 *
 * Owned by worktree feature/fx-bento-backend.
 *
 * Money model (the rule the contracts must enforce):
 *   prize_pool   = sum(entry_fees)
 *   protocol_take = prize_pool * rakeBps / 10_000
 *   payouts      = prize_pool - protocol_take
 *   Protocol NEVER tops up the prize pool.
 *   No refunds unless the room failed to start.
 *
 * Settlement is commit-reveal: players commit to a chip placement hash
 * during the game, then reveal salt+tile+chips at end. The backend
 * verifies each reveal matches the on-chain commitment, scores the
 * placement against the oracle snapshot, and emits the settle tx.
 */

export * from "./schemas";
export * from "./service";
export type { ArcadeRoom, PlayerChipPlacement, RoomStatus } from "@bufi/shared-types";
