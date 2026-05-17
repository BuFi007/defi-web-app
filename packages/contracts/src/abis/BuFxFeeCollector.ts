export const buFxFeeCollectorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "initialOwner", type: "address" },
      { name: "initialFeeToken", type: "address" },
      { name: "initialFeeConfig", type: "address" },
      { name: "initialTreasury", type: "address" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setAuthorizedCollector",
    inputs: [
      { name: "collector", type: "address" },
      { name: "authorized", type: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "collectSpotFee",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "trader", type: "address" },
      { name: "referrer", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        components: [
          { name: "grossFee", type: "uint256" },
          { name: "discount", type: "uint256" },
          { name: "netFee", type: "uint256" },
          { name: "referralAmount", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" }
        ]
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "collectRfqFee",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "trader", type: "address" },
      { name: "referrer", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        components: [
          { name: "grossFee", type: "uint256" },
          { name: "discount", type: "uint256" },
          { name: "netFee", type: "uint256" },
          { name: "referralAmount", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" }
        ]
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "collectPerpLiquidityFee",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "trader", type: "address" },
      { name: "referrer", type: "address" },
      { name: "notionalUsd", type: "uint256" }
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        components: [
          { name: "grossFee", type: "uint256" },
          { name: "discount", type: "uint256" },
          { name: "netFee", type: "uint256" },
          { name: "referralAmount", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" }
        ]
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    name: "VenueFeeCollected",
    anonymous: false,
    inputs: [
      { name: "requestId", type: "bytes32", indexed: true },
      { name: "feeType", type: "bytes32", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "trader", type: "address", indexed: false },
      { name: "referrer", type: "address", indexed: false },
      { name: "feeToken", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "grossFee", type: "uint256", indexed: false },
      { name: "discount", type: "uint256", indexed: false },
      { name: "netFee", type: "uint256", indexed: false },
      { name: "referralAmount", type: "uint256", indexed: false },
      { name: "treasuryAmount", type: "uint256", indexed: false }
    ]
  }
] as const;
