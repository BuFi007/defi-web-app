// SPDX-License-Identifier: Apache-2.0
// Minimal Phase D ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxHealthCheckerAbi = [
  {
    type: "function",
    name: "healthFactor",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "ratioBps", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isLiquidatable",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maintenanceMargin",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
