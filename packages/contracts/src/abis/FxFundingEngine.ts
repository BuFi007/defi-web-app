// SPDX-License-Identifier: Apache-2.0
// Minimal Phase C ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxFundingEngineAbi = [
  {
    type: "function",
    name: "settleFunding",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "fundingPaid", type: "int256", internalType: "int256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getFundingIndex",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "version", type: "uint64", internalType: "uint64" },
    ],
    outputs: [{ name: "cumulativeFundingE18", type: "int256", internalType: "int256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pokeFundingRate",
    inputs: [{ name: "marketId", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
