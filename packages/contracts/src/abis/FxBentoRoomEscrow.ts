// SPDX-License-Identifier: Apache-2.0
// FXBentoRoomEscrow ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoRoomEscrowAbi = parseAbi([
  "event RoomJoined(uint256 indexed roomId, address indexed player)",
  "event RoomLeft(uint256 indexed roomId, address indexed player)",
  "event RoomCancelled(uint256 indexed roomId)",
  "event RoomLocked(uint256 indexed roomId, uint256 escrowed)",
  "event RoomSettled(uint256 indexed roomId, bytes32 indexed resultsRoot, bytes32 indexed payoutSchemaHash, uint256 payoutTotal, uint256 protocolFee)",
  "event SettlementManagerUpdated(address indexed settlementManager)",
  "event Refunded(uint256 indexed roomId, address indexed player, uint256 amount)",
  "event PrizeClaimed(uint256 indexed roomId, address indexed player, uint256 amount)",
  "event ProtocolFeeClaimed(uint256 indexed roomId, uint256 amount)",
  "function joinRoom(uint256 roomId)",
  "function leaveRoom(uint256 roomId)",
  "function cancelRoom(uint256 roomId)",
  "function refund(uint256 roomId)",
  "function lockRoom(uint256 roomId)",
  "function settleRoom(uint256 roomId, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, bytes attestation)",
  "function claimPrize(uint256 roomId, uint256 amount, bytes32[] proof)",
  "function claimProtocolFee(uint256 roomId)",
  "function players(uint256 roomId) view returns (address[])",
  "function joined(uint256 roomId, address player) view returns (bool)",
  "function refunded(uint256 roomId, address player) view returns (bool)",
  "function prizeClaimed(uint256 roomId, address player) view returns (bool)",
  "function resultsRoot(uint256 roomId) view returns (bytes32)",
  "function escrowed(uint256 roomId) view returns (uint256)",
  "function protocolFee(uint256 roomId) view returns (uint256)",
  "function payoutTotal(uint256 roomId) view returns (uint256)",
  "function payoutSchemaHash(uint256 roomId) view returns (bytes32)",
  "function totalPrizeClaimed(uint256 roomId) view returns (uint256)",
]);
