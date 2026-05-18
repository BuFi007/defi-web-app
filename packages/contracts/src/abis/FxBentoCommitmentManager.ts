// SPDX-License-Identifier: Apache-2.0
// FXBentoCommitmentManager ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoCommitmentManagerAbi = parseAbi([
  "event SelectionCommitted(uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 commitment)",
  "event SelectionRevealed(uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 selectedTilesHash)",
  "function hashSelection(uint256 roomId, uint16 roundIndex, address player, bytes32 selectedTilesHash, bytes32 nonce) view returns (bytes32)",
  "function commitSelection(uint256 roomId, uint16 roundIndex, bytes32 commitment)",
  "function commitSelectionFor(uint256 roomId, uint16 roundIndex, address player, bytes32 commitment, bytes signature)",
  "function revealSelection(uint256 roomId, uint16 roundIndex, (uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, bytes32 nonce)",
  "function commitments(uint256 roomId, uint16 roundIndex, address player) view returns (bytes32)",
  "function revealedSelectionHash(uint256 roomId, uint16 roundIndex, address player) view returns (bytes32)",
]);
