// In-memory room simulator. Lives alongside the real engine so tests + the
// /fx-bento/dev/* routes can exercise lifecycle transitions without onchain
// state. Ported from fx-bento monorepo's `packages/fx-bento/src/index.ts`
// memory-room block (split out here for clarity).

import { roomIdForArcadeRoom } from "@bufi/liveblocks";

import {
  CommitSelectionSchema,
  CreateFxBentoRoomSchema,
  HexSchema,
  JoinFxBentoRoomSchema,
  RevealSelectionSchema,
  SettleFxBentoRoomSchema,
  nowIso,
  requireMarket,
  type CreateFxBentoRoomInput,
  type FxBentoRoomStatus,
} from "./schemas";

export interface FxBentoRoom {
  id: string;
  liveblocksRoomId: string;
  marketId: string;
  entryFeeUsdc: number;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  players: string[];
  playerEntries: Array<{ player: string; entryTxHash: string | null; joinedAt: string }>;
  status: FxBentoRoomStatus;
  createdAt: string;
  startTime: string | null;
  leaderboard: Array<{ player: string; score: number }>;
  commitments: Array<{ player: string; roundIndex: number; commitment: string; at: string }>;
  reveals: Array<{
    player: string;
    roundIndex: number;
    rows: number[];
    cols: number[];
    at: string;
  }>;
  settlementRoot: string | null;
  settlementTxHash: string | null;
}

const rooms = new Map<string, FxBentoRoom>();

export function createFxBentoRoom(input: CreateFxBentoRoomInput): FxBentoRoom {
  const parsed = CreateFxBentoRoomSchema.parse(input);
  requireMarket(parsed.marketId);
  if (parsed.minPlayers > parsed.maxPlayers) throw new Error("minPlayers cannot exceed maxPlayers");
  const id = `room_${crypto.randomUUID().slice(0, 8)}`;
  const room: FxBentoRoom = {
    id,
    liveblocksRoomId: fxBentoArcadeRoomId(id),
    marketId: parsed.marketId,
    entryFeeUsdc: parsed.entryFeeUsdc,
    minPlayers: parsed.minPlayers,
    maxPlayers: parsed.maxPlayers,
    rounds: parsed.rounds,
    players: [],
    playerEntries: [],
    status: "lobby",
    createdAt: nowIso(),
    startTime: parsed.startTime ?? null,
    leaderboard: [],
    commitments: [],
    reveals: [],
    settlementRoot: null,
    settlementTxHash: null,
  };
  rooms.set(room.id, room);
  return room;
}

export function listFxBentoRooms(): FxBentoRoom[] {
  return [...rooms.values()];
}

export function getFxBentoRoom(id: string): FxBentoRoom | null {
  return rooms.get(id) ?? null;
}

export function joinFxBentoRoom(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = JoinFxBentoRoomSchema.parse(input);
  if (room.status !== "lobby") throw new Error("room_not_joinable");
  const player = parsed.player.toLowerCase();
  if (!room.players.includes(player)) {
    if (room.players.length >= room.maxPlayers) throw new Error("room_full");
    room.players.push(player);
    room.playerEntries.push({
      player,
      entryTxHash: parsed.entryTxHash ?? null,
      joinedAt: nowIso(),
    });
  }
  activateIfReady(room);
  return {
    roomId: room.id,
    player,
    liveblocksRoomId: room.liveblocksRoomId,
    onchainRequired: true,
    message: "Submit entry fee to FXBentoRoomEscrow; backend does not custody funds.",
  };
}

export function commitFxBentoSelection(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = CommitSelectionSchema.parse(input);
  assertRoomActive(room);
  assertRound(room, parsed.roundIndex);
  const player = parsed.player.toLowerCase();
  assertPlayer(room, player);
  if (
    room.commitments.some(
      (commitment) => commitment.player === player && commitment.roundIndex === parsed.roundIndex,
    )
  ) {
    throw new Error("commitment_already_exists");
  }
  room.commitments.push({
    player,
    roundIndex: parsed.roundIndex,
    commitment: parsed.commitment,
    at: nowIso(),
  });
  return { roomId: room.id, accepted: true, commitment: parsed.commitment };
}

export function revealFxBentoSelection(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = RevealSelectionSchema.parse(input);
  assertRoomActive(room);
  assertRound(room, parsed.roundIndex);
  if (parsed.rows.length !== parsed.cols.length) throw new Error("rows_cols_length_mismatch");
  const player = parsed.player.toLowerCase();
  assertPlayer(room, player);
  assertValidTilePattern(parsed.rows, parsed.cols);
  const commitment = room.commitments.find(
    (item) => item.player === player && item.roundIndex === parsed.roundIndex,
  );
  if (!commitment) throw new Error("missing_commitment");
  if (
    room.reveals.some((item) => item.player === player && item.roundIndex === parsed.roundIndex)
  ) {
    throw new Error("selection_already_revealed");
  }
  room.reveals.push({
    player,
    roundIndex: parsed.roundIndex,
    rows: parsed.rows,
    cols: parsed.cols,
    at: nowIso(),
  });
  return { roomId: room.id, accepted: true, tiles: parsed.rows.length };
}

export function settleFxBentoRoom(id: string, input: unknown) {
  const room = requireRoom(id);
  const parsed = SettleFxBentoRoomSchema.parse(input);
  if (room.players.length < room.minPlayers) throw new Error("min_players_not_met");
  if (room.status === "settled") throw new Error("room_already_settled");
  if (room.status === "cancelled") throw new Error("room_cancelled");
  room.status = "settling";
  room.settlementRoot = parsed.resultsRoot;
  return {
    roomId: room.id,
    status: room.status,
    resultsRoot: parsed.resultsRoot,
    onchainRequired: true,
  };
}

export function getFxBentoLeaderboard(id: string) {
  return requireRoom(id).leaderboard;
}

export function markFxBentoRoomSettled(id: string, txHash: string) {
  const room = requireRoom(id);
  if (room.status !== "settling") throw new Error("room_not_settling");
  HexSchema.parse(txHash);
  room.status = "settled";
  room.settlementTxHash = txHash;
  return room;
}

export function resetFxBentoRoomsForTests(): void {
  rooms.clear();
}

// ---------- backward-compat adapter ----------
// `services.ts` and `routes/mcp.ts` still call `createInMemoryFxBentoService()`
// with the previous stub's interface (createRoom, listRooms, etc.). This thin
// adapter keeps those call sites working without forcing edits to files owned
// by other agents. The mcp tool only calls `createRoom(...)` today.

export interface LegacyFxBentoService {
  createRoom(input: {
    chainId: number;
    marketId: string;
    entryFeeUsdc: string;
    chipsPerPlayer: number;
    maxPlayers: number;
    startsAt: number;
    endsAt: number;
    rakeBps: number;
  }): Promise<{ roomId: string; escrowAddress: `0x${string}` }>;
  listRooms(status?: string): Promise<FxBentoRoom[]>;
  getRoom(roomId: string): Promise<FxBentoRoom | null>;
}

export function createInMemoryFxBentoService(): LegacyFxBentoService {
  return {
    async createRoom(input) {
      const room = createFxBentoRoom({
        marketId: input.marketId,
        entryFeeUsdc: Number(input.entryFeeUsdc) || 1,
        minPlayers: 2,
        maxPlayers: Math.max(2, input.maxPlayers),
        rounds: 1,
      });
      // Address is non-custodial — the contract escrow holds funds, not the API.
      // Return zero address so legacy callers don't accidentally treat this as authoritative.
      return {
        roomId: room.id,
        escrowAddress: "0x0000000000000000000000000000000000000000",
      };
    },
    async listRooms(status) {
      const all = listFxBentoRooms();
      return status ? all.filter((room) => room.status === status) : all;
    },
    async getRoom(roomId) {
      return getFxBentoRoom(roomId);
    },
  };
}

// ---------- internals ----------

function fxBentoArcadeRoomId(roomId: string): string {
  // The destination `@bufi/liveblocks` room namer wants a chainId; the
  // simulator does not know one, so we use chainId=0 as the "no-chain"
  // sentinel. Production API endpoints call roomIdForArcadeRoom directly
  // with the request's chain.
  return roomIdForArcadeRoom(0, roomId);
}

function requireRoom(id: string): FxBentoRoom {
  const room = rooms.get(id);
  if (!room) throw new Error("room_not_found");
  return room;
}

function activateIfReady(room: FxBentoRoom): void {
  if (room.status !== "lobby") return;
  if (room.players.length < room.minPlayers) return;
  if (room.startTime && Date.parse(room.startTime) > Date.now()) return;
  room.status = "active";
}

function assertRoomActive(room: FxBentoRoom): void {
  activateIfReady(room);
  if (room.status !== "active") throw new Error("room_not_active");
}

function assertRound(room: FxBentoRoom, roundIndex: number): void {
  if (roundIndex < 0 || roundIndex >= room.rounds) throw new Error("round_out_of_bounds");
}

function assertPlayer(room: FxBentoRoom, player: string): void {
  if (!room.players.includes(player)) throw new Error("player_not_in_room");
}

export function assertValidTilePattern(rows: number[], cols: number[]): void {
  if (rows.length === 0 || rows.length !== cols.length || rows.length > 5) {
    throw new Error("invalid_tile_count");
  }
  const seen = new Set<string>();
  const rowCounts = new Map<number, number>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? -1;
    const col = cols[index] ?? -1;
    const key = `${row}:${col}`;
    if (seen.has(key)) throw new Error("duplicate_tile");
    seen.add(key);
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
    if ((rowCounts.get(row) ?? 0) > 2) throw new Error("too_many_tiles_in_row");
  }
  const byRow = new Map<number, number[]>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? -1;
    const col = cols[index] ?? -1;
    byRow.set(row, [...(byRow.get(row) ?? []), col]);
  }
  for (const columns of byRow.values()) {
    const sorted = columns.sort((a, b) => a - b);
    let chain = 1;
    for (let index = 1; index < sorted.length; index++) {
      chain = sorted[index] === (sorted[index - 1] ?? -99) + 1 ? chain + 1 : 1;
      if (chain > 2) throw new Error("horizontal_wall");
    }
  }
}
