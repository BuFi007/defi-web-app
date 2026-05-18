// SPDX-License-Identifier: Apache-2.0
// FXBentoScoring ABI — ported from fx-bento monorepo. Pure-function scoring lib.
import { parseAbi } from "viem";

export const FxBentoScoringAbi = parseAbi([
  "function validateAntiWall((uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, uint8 maxRows, uint8 maxCols) pure returns (bool)",
  "function scoreHit(uint256 tileDifficultyScore, uint8 selectedTileCount) pure returns (uint256)",
  "function scoreSelection((uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection, uint8 hitIndex, uint256 difficulty) pure returns (uint256)",
]);
