// SPDX-License-Identifier: Apache-2.0
// Minimal Phase D ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxLiquidationEngineAbi = [
  {
    type: "function",
    name: "flagAccount",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "liquidate",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
      { name: "maxSizeToCloseAbs", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      { name: "liquidatorReward", type: "uint256", internalType: "uint256" },
      { name: "socializedLoss", type: "int256", internalType: "int256" },
    ],
    stateMutability: "nonpayable",
  },
] as const;
