// SPDX-License-Identifier: Apache-2.0
// FXBentoSettlementManager ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoSettlementManagerAbi = parseAbi([
  "event ResultsSubmitted(uint256 indexed roomId, bytes32 indexed resultsRoot, string metadataURI)",
  "event ResultsChallenged(uint256 indexed roomId, bytes proof)",
  "event ChallengeResolved(uint256 indexed roomId, bool accepted)",
  "event ResultsFinalized(uint256 indexed roomId, bytes32 indexed resultsRoot)",
  "event SettlementRescueDelayUpdated(uint64 settlementRescueDelay)",
  "event SettlementRescued(uint256 indexed roomId)",
  "function setChallengeWindow(uint64 challengeWindow)",
  "function setRoundManager(address roundManager)",
  "function setSettlementRescueDelay(uint64 settlementRescueDelay)",
  "function submitResults(uint256 roomId, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, string metadataURI, bytes attestation)",
  "function challengeResults(uint256 roomId, bytes proof)",
  "function resolveChallenge(uint256 roomId, bool acceptChallenge, (uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) replacement, string metadataURI)",
  "function finalizeResults(uint256 roomId)",
  "function rescueFailedSettlement(uint256 roomId)",
  "function challengeWindow() view returns (uint64)",
  "function settlementRescueDelay() view returns (uint64)",
  "function settlementRescueDeadline(uint256 roomId) view returns (uint64)",
  "function pendingResults(uint256 roomId) view returns ((uint256 roomId,bytes32 winnerRoot,bytes32 rosterHash,bytes32 leaderboardHash,bytes32 scoreRoot,bytes32 settlementPriceRoot,uint256 payoutTotal,uint256 protocolFee,bytes32 metadataHash) payout, bytes32 payoutSchemaHash, string metadataURI, bytes attestation, uint64 submittedAt, uint64 challengedAt, uint8 challengeStatus, bool challenged, bool finalized, bool resolved)",
]);
