import type { ArcadeRoom, PlayerChipPlacement, RoomStatus } from "@bufi/shared-types";
import { encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress, type Hex } from "viem";

import {
  commitRequest,
  createRoomRequest,
  joinRoomRequest,
  revealRequest,
  settleRequest,
  type CommitRequest,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type JoinRoomRequest,
  type JoinRoomResponse,
  type RevealRequest,
  type SettleRequest,
  type SettleResponse,
} from "./schemas";

export interface FxBentoService {
  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>;
  getRoom(roomId: string): Promise<ArcadeRoom | null>;
  listRooms(status?: RoomStatus): Promise<ArcadeRoom[]>;
  joinRoom(req: JoinRoomRequest): Promise<JoinRoomResponse>;
  commit(req: CommitRequest): Promise<{ ok: true }>;
  reveal(req: RevealRequest): Promise<{ ok: true }>;
  placements(roomId: string): Promise<PlayerChipPlacement[]>;
  leaderboard(roomId: string): Promise<Array<{ player: string; score: number; rank: number }>>;
  settle(req: SettleRequest): Promise<SettleResponse>;
}

export function createInMemoryFxBentoService(): FxBentoService {
  const rooms = new Map<string, ArcadeRoom>();
  const commitments = new Map<string, CommitRequest>();
  const revealed = new Map<string, PlayerChipPlacement>();
  return {
    async createRoom(req) {
      const parsed = createRoomRequest.parse(req);
      const roomId = `bento_${parsed.chainId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      rooms.set(roomId, {
        roomId,
        chainId: parsed.chainId,
        marketId: parsed.marketId,
        entryFeeUsdc: parsed.entryFeeUsdc,
        chipsPerPlayer: parsed.chipsPerPlayer,
        maxPlayers: parsed.maxPlayers,
        status: "waiting",
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        prizePoolUsdc: "0",
        rakeBps: parsed.rakeBps,
      });
      return { roomId, escrowAddress: zeroAddress };
    },
    async getRoom(roomId) {
      return rooms.get(roomId) ?? null;
    },
    async listRooms(status) {
      return [...rooms.values()].filter((room) => !status || room.status === status);
    },
    async joinRoom(req) {
      const parsed = joinRoomRequest.parse(req);
      if (!rooms.has(parsed.roomId)) throw new Error(`unknown room ${parsed.roomId}`);
      return {
        roomId: parsed.roomId,
        digest: keccak256(
          encodeAbiParameters(parseAbiParameters("string roomId, address player"), [
            parsed.roomId,
            parsed.player as Hex,
          ]),
        ),
        deadline: Math.floor(Date.now() / 1000) + 900,
      };
    },
    async commit(req) {
      const parsed = commitRequest.parse(req);
      if (!rooms.has(parsed.roomId)) throw new Error(`unknown room ${parsed.roomId}`);
      commitments.set(commitmentKey(parsed.roomId, parsed.player), parsed);
      return { ok: true };
    },
    async reveal(req) {
      const parsed = revealRequest.parse(req);
      const committed = commitments.get(commitmentKey(parsed.roomId, parsed.player));
      if (!committed) throw new Error("missing commitment");
      const expected = computeChipCommitment({
        salt: parsed.salt as Hex,
        tileId: parsed.tileId,
        chips: parsed.chips,
      });
      if (expected.toLowerCase() !== committed.commitment.toLowerCase()) {
        throw new Error("reveal does not match commitment");
      }
      revealed.set(commitmentKey(parsed.roomId, parsed.player), {
        player: parsed.player as PlayerChipPlacement["player"],
        tileId: parsed.tileId,
        chips: parsed.chips,
        commitment: committed.commitment as Hex,
        revealSalt: parsed.salt as Hex,
      });
      return { ok: true };
    },
    async placements(roomId) {
      return [...revealed.entries()]
        .filter(([key]) => key.startsWith(`${roomId}:`))
        .map(([, placement]) => placement);
    },
    async leaderboard(roomId) {
      const placements = await this.placements(roomId);
      return placements
        .map((placement) => ({
          player: placement.player,
          score: placement.chips,
          rank: 0,
        }))
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
    },
    async settle(req) {
      const parsed = settleRequest.parse(req);
      const room = rooms.get(parsed.roomId);
      if (!room) throw new Error(`unknown room ${parsed.roomId}`);
      throw new Error(
        "FX Bento settlement contract is not configured; do not distribute prize money from in-memory state",
      );
    },
  };
}

export function computeChipCommitment(args: { salt: Hex; tileId: string; chips: number }): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32 salt, string tileId, uint256 chips"), [
      args.salt,
      args.tileId,
      BigInt(args.chips),
    ]),
  );
}

function commitmentKey(roomId: string, player: string): string {
  return `${roomId}:${player.toLowerCase()}`;
}
