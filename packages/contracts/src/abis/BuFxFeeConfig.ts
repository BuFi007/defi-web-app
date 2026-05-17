export const buFxFeeConfigAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "initialOwner", type: "address" },
      { name: "initialTreasury", type: "address" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setVenueFeeConfig",
    inputs: [
      { name: "marketId", type: "bytes32" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "spotFeeBps", type: "uint256" },
          { name: "rfqFeeBps", type: "uint256" },
          { name: "perpLiquidityFeeBps", type: "uint256" },
          { name: "referralDiscountBps", type: "uint256" },
          { name: "referralShareBps", type: "uint256" },
          { name: "enabled", type: "bool" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "venueFeeConfig",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "spotFeeBps", type: "uint256" },
          { name: "rfqFeeBps", type: "uint256" },
          { name: "perpLiquidityFeeBps", type: "uint256" },
          { name: "referralDiscountBps", type: "uint256" },
          { name: "referralShareBps", type: "uint256" },
          { name: "enabled", type: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "previewSpotFee",
    inputs: [
      { name: "marketId", type: "bytes32" },
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
    stateMutability: "view"
  },
  {
    type: "function",
    name: "previewRfqFee",
    inputs: [
      { name: "marketId", type: "bytes32" },
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
    stateMutability: "view"
  },
  {
    type: "function",
    name: "previewPerpLiquidityFee",
    inputs: [
      { name: "marketId", type: "bytes32" },
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
    stateMutability: "view"
  },
  {
    type: "event",
    name: "VenueFeeConfigSet",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "spotFeeBps", type: "uint256", indexed: false },
      { name: "rfqFeeBps", type: "uint256", indexed: false },
      { name: "perpLiquidityFeeBps", type: "uint256", indexed: false },
      { name: "referralDiscountBps", type: "uint256", indexed: false },
      { name: "referralShareBps", type: "uint256", indexed: false },
      { name: "enabled", type: "bool", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "VenueFeeQuoted",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "feeType", type: "bytes32", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "referrer", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "grossFee", type: "uint256", indexed: false },
      { name: "discount", type: "uint256", indexed: false },
      { name: "netFee", type: "uint256", indexed: false },
      { name: "referralAmount", type: "uint256", indexed: false },
      { name: "treasuryAmount", type: "uint256", indexed: false }
    ],
    anonymous: false
  }
] as const;
