// SPDX-License-Identifier: Apache-2.0
// Minimal Phase E ABI from fx-telarana/docs/CODEX_BRIEF_PHASES_B_TO_E.md.
export const FxOrderSettlementAbi = [
  {
    type: "event",
    name: "MatchSettled",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "maker", type: "address", indexed: true, internalType: "address" },
      { name: "taker", type: "address", indexed: true, internalType: "address" },
      { name: "fillSizeE18", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "fillPriceE18", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "trader", type: "address", indexed: true, internalType: "address" },
      { name: "nonce", type: "uint64", indexed: false, internalType: "uint64" },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
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
  {
    type: "function",
    name: "settleMatch",
    inputs: [
      {
        name: "maker",
        type: "tuple",
        internalType: "struct SignedOrder",
        components: [
          { name: "trader", type: "address", internalType: "address" },
          { name: "marketId", type: "bytes32", internalType: "bytes32" },
          { name: "sizeDeltaE18", type: "int256", internalType: "int256" },
          { name: "priceE18", type: "uint256", internalType: "uint256" },
          { name: "orderType", type: "uint8", internalType: "uint8" },
          { name: "flags", type: "uint8", internalType: "uint8" },
          { name: "nonce", type: "uint64", internalType: "uint64" },
          { name: "deadline", type: "uint64", internalType: "uint64" },
        ],
      },
      { name: "makerSig", type: "bytes", internalType: "bytes" },
      {
        name: "taker",
        type: "tuple",
        internalType: "struct SignedOrder",
        components: [
          { name: "trader", type: "address", internalType: "address" },
          { name: "marketId", type: "bytes32", internalType: "bytes32" },
          { name: "sizeDeltaE18", type: "int256", internalType: "int256" },
          { name: "priceE18", type: "uint256", internalType: "uint256" },
          { name: "orderType", type: "uint8", internalType: "uint8" },
          { name: "flags", type: "uint8", internalType: "uint8" },
          { name: "nonce", type: "uint64", internalType: "uint64" },
          { name: "deadline", type: "uint64", internalType: "uint64" },
        ],
      },
      { name: "takerSig", type: "bytes", internalType: "bytes" },
      { name: "fillSizeE18", type: "uint256", internalType: "uint256" },
      { name: "fillPriceE18", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelOrder",
    inputs: [{ name: "nonce", type: "uint64", internalType: "uint64" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nonceBitmap",
    inputs: [
      { name: "trader", type: "address", internalType: "address" },
      { name: "wordPos", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
