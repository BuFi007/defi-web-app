export const CCIPTransferAbi = [
  {
    inputs: [
      {
        internalType: "uint64",
        name: "_destinationChainSelector",
        type: "uint64",
      },
      {
        internalType: "address",
        name: "_receiver",
        type: "address",
      },
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "transferTokensPayLINK",
    outputs: [
      {
        internalType: "bytes32",
        name: "messageId",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const spokeAbi = [
  {
    inputs: [
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
    ],
    name: "depositCollateral",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    name: "depositCollateralNative",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
    ],
    name: "withdrawCollateral",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
      { internalType: "bool", name: "unwrap", type: "bool" },
    ],
    name: "withdrawCollateralNative",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
    ],
    name: "borrow",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
      { internalType: "bool", name: "unwrap", type: "bool" },
    ],
    name: "borrowNative",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "assetAmount", type: "uint256" },
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
    ],
    name: "repay",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "costForReturnDelivery",
        type: "uint256",
      },
    ],
    name: "repayNative",
    outputs: [{ internalType: "uint64", name: "sequence", type: "uint64" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

export const hubAbi = [
  {
    type: "function",
    name: "getVaultAmounts",
    stateMutability: "view",
    inputs: [
      { name: "vaultOwner", type: "address" },
      { name: "assetAddress", type: "address" },
    ],
    outputs: [
      {
        components: [
          { name: "deposited", type: "uint256" },
          { name: "borrowed", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "getGlobalAmounts",
    stateMutability: "view",
    inputs: [{ name: "assetAddress", type: "address" }],
    outputs: [
      {
        components: [
          { name: "deposited", type: "uint256" },
          { name: "borrowed", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
] as const;
