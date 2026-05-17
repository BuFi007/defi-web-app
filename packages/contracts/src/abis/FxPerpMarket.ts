// SPDX-License-Identifier: Apache-2.0
// Minimal Phase B ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxPerpMarketAbi = [
  {
    type: "function",
    name: "marketId",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "position",
    inputs: [{ name: "trader", type: "address", internalType: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Position",
        components: [
          { name: "size", type: "int256", internalType: "int256" },
          { name: "entryPriceE18", type: "uint256", internalType: "uint256" },
          { name: "marginReserved", type: "uint256", internalType: "uint256" },
          { name: "lastSettleVersion", type: "uint64", internalType: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "openInterestLong",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "openInterestShort",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxOpenInterest",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
