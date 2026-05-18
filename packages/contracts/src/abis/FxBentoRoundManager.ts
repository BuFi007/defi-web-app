// SPDX-License-Identifier: Apache-2.0
// FXBentoRoundManager ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoRoundManagerAbi = parseAbi([
  "event RoundStarted(uint256 indexed roomId, uint16 indexed roundIndex, uint64 startTime, uint64 lockTime, uint64 endTime, uint256 anchorSnapshotId)",
  "event AnchorRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId)",
  "event SettlementRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId)",
  "function startRound(uint256 roomId, uint16 roundIndex, uint64 startTime, uint64 endTime, uint64 lockTime, bytes32 gridConfigHash)",
  "function recordAnchor(uint256 roomId, uint16 roundIndex, int256 price)",
  "function recordSettlement(uint256 roomId, uint16 roundIndex)",
  "function getRound(uint256 roomId, uint16 roundIndex) view returns ((uint256 roomId,uint16 roundIndex,bytes32 poolId,uint64 startTime,uint64 endTime,uint64 lockTime,int256 anchorPrice,int256 settlementPrice,uint256 anchorSnapshotId,uint256 settlementSnapshotId,bytes32 gridConfigHash,uint8 status))",
  "function allRoundsEnded(uint256 roomId) view returns (bool)",
]);
