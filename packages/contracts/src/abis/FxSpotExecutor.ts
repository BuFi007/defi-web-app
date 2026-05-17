// Minimal ABI for Telarana FxSpotExecutor (Phase A v0.1).
// v0.1 collapses executeSpotFx to take only requestId — the executor reads
// recipient/minAmountOut/amount/tokenOut from the canonical TGH receipt.
// See FxSpotExecutor NatSpec for changelog from v0 → v0.1.
export const fxSpotExecutorAbi = [
  {
    type: "function",
    name: "executeSpotFx",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "amountOut", type: "uint256" }]
  },
  {
    type: "function",
    name: "executed",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "reserveOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "event",
    name: "SpotFxExecuted",
    inputs: [
      { name: "requestId", type: "bytes32", indexed: true },
      { name: "routeId", type: "bytes32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: false },
      { name: "usdcIn", type: "uint256", indexed: false },
      { name: "tokenOutDelivered", type: "uint256", indexed: false },
      { name: "midE18", type: "uint256", indexed: false },
      { name: "appliedSpreadBps", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "from", type: "address", indexed: true }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "LiquidityWithdrawn",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true }
    ],
    anonymous: false
  }
] as const;
