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

import type { ArcadeRoom, PlayerChipPlacement, RoomStatus } from "@bufi/shared-types";

import type {
  CommitRequest,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  RevealRequest,
  SettleRequest,
  SettleResponse,
} from "./schemas";

export * from "./schemas";

export interface FxBentoService {
  /** Create a new arcade room. Charges room-creation fee via x402. */
  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>;
  /** Get current room state, hydrated from Ponder. */
  getRoom(roomId: string): Promise<ArcadeRoom | null>;
  /** List rooms by status. */
  listRooms(status?: RoomStatus): Promise<ArcadeRoom[]>;
  /** Issue the EIP-712 digest a player signs to authorize entry. */
  joinRoom(req: JoinRoomRequest): Promise<JoinRoomResponse>;
  /** Record a commit (no chain write — just indexed off-chain UI hint). */
  commit(req: CommitRequest): Promise<{ ok: true }>;
  /** Verify reveal matches commit, then forward to the contract. */
  reveal(req: RevealRequest): Promise<{ ok: true }>;
  /** Read the current placements (revealed only — pre-reveal stays opaque). */
  placements(roomId: string): Promise<PlayerChipPlacement[]>;
  /** Compute leaderboard against the current oracle snapshot. */
  leaderboard(roomId: string): Promise<Array<{ player: string; score: number; rank: number }>>;
  /** Settle the room and emit the prize-distribution tx. */
  settle(req: SettleRequest): Promise<SettleResponse>;
}

export type { ArcadeRoom, PlayerChipPlacement, RoomStatus };
