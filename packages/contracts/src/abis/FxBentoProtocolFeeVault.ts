// SPDX-License-Identifier: Apache-2.0
// ProtocolFeeVault (FX² Arcade) ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoProtocolFeeVaultAbi = parseAbi([
  "event TreasuryUpdated(address indexed treasury)",
  "event FeeReceived(address indexed token, uint256 indexed roomId, uint256 amount)",
  "event FeeSwept(address indexed token, address indexed treasury, uint256 amount)",
  "function setTreasury(address treasury)",
  "function notifyFee(address token, uint256 roomId, uint256 amount)",
  "function sweep(address token)",
  "function treasury() view returns (address)",
]);
