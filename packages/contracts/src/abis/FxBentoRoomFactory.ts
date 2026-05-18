// SPDX-License-Identifier: Apache-2.0
// FXBentoRoomFactory ABI — ported from fx-bento monorepo
// (packages/contracts/src/index.ts → FX_BENTO_ROOM_FACTORY_ABI).
import { parseAbi } from "viem";

export const FxBentoRoomFactoryAbi = parseAbi([
  "event RoomCreated(uint256 indexed roomId, bytes32 indexed poolId, address indexed entryToken, uint256 entryFee)",
  "event RoomStatusUpdated(uint256 indexed roomId, uint8 status)",
  "event EntryTokenAllowed(address indexed token, bool allowed)",
  "event LimitsUpdated(uint16 maxRakeBps, uint16 protocolMaxPlayers)",
  "event EscrowUpdated(address indexed escrow)",
  "function createRoom(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,address entryToken,uint256 entryFee,uint16 minPlayers,uint16 maxPlayers,uint16 rounds,uint32 roundDuration,uint32 lockBuffer,uint64 startTime,uint16 rakeBps,uint16[] payoutBps,bytes32 gridConfigHash,bool isPrivate,bytes32 inviteCodeHash) config) returns (uint256 roomId)",
  "function transitionRoomStatus(uint256 roomId, uint8 expectedStatus, uint8 nextStatus)",
  "function setEscrow(address escrow)",
  "function setEntryToken(address token, bool allowed)",
  "function setLimits(uint16 maxRakeBps, uint16 protocolMaxPlayers)",
  "function getRoom(uint256 roomId) view returns ((bytes32 poolId,address entryToken,uint256 entryFee,uint16 minPlayers,uint16 maxPlayers,uint16 rounds,uint32 roundDuration,uint32 lockBuffer,uint64 startTime,uint16 rakeBps,bytes32 payoutHash,bytes32 gridConfigHash,bool isPrivate,bytes32 inviteCodeHash,uint8 status))",
  "function getPayoutBps(uint256 roomId) view returns (uint16[])",
  "function allowedEntryToken(address token) view returns (bool)",
  "function nextRoomId() view returns (uint256)",
]);
