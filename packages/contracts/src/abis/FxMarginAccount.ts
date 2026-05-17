// SPDX-License-Identifier: Apache-2.0
// Minimal Phase B ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxMarginAccountAbi = [
  {
    type: "function",
    name: "depositMargin",
    inputs: [
      { name: "trader", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawMargin",
    inputs: [
      { name: "trader", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "marginOf",
    inputs: [{ name: "trader", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reservedMarginOf",
    inputs: [{ name: "trader", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "freeMarginOf",
    inputs: [{ name: "trader", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "InsufficientFreeMargin",
    inputs: [
      { name: "trader", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "free", type: "uint256", internalType: "uint256" },
    ],
  },
] as const;
