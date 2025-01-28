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
    type: "constructor",
    inputs: [ 
      { name: "wormholeRelayer", type: "address", internalType: "address" },
      { name: "wormhole", type: "address", internalType: "address" },
      { name: "tokenBridge", type: "address", internalType: "address" },
      { name: "consistencyLevel", type: "uint8", internalType: "uint8" },
      { name: "pythAddress", type: "address", internalType: "address" },
      { name: "oracleMode", type: "uint8", internalType: "uint8" },
      {
        name: "priceStandardDeviations",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "priceStandardDeviationsPrecision",
        type: "uint64",
        internalType: "uint64",
      },
      { name: "maxLiquidationBonus", type: "uint256", internalType: "uint256" },
      {
        name: "maxLiquidationPortion",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maxLiquidationPortionPrecision",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "interestAccrualIndexPrecision",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "collateralizationRatioPrecision",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "LIQUIDATOR_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "denormalizeAmount",
    inputs: [
      { name: "normalizedAmount", type: "uint256", internalType: "uint256" },
      {
        name: "interestAccrualIndex",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "round",
        type: "uint8",
        internalType: "enum HubSpokeStructs.Round",
      },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAssetInfo",
    inputs: [
      { name: "assetAddress", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HubSpokeStructs.AssetInfo",
        components: [
          {
            name: "collateralizationRatioDeposit",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "collateralizationRatioBorrow",
            type: "uint256",
            internalType: "uint256",
          },
          { name: "pythId", type: "bytes32", internalType: "bytes32" },
          { name: "decimals", type: "uint8", internalType: "uint8" },
          {
            name: "interestRateModel",
            type: "tuple",
            internalType: "struct HubSpokeStructs.PiecewiseInterestRateModel",
            components: [
              { name: "ratePrecision", type: "uint64", internalType: "uint64" },
              { name: "kinks", type: "uint256[]", internalType: "uint256[]" },
              { name: "rates", type: "uint256[]", internalType: "uint256[]" },
              {
                name: "reserveFactor",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "reservePrecision",
                type: "uint256",
                internalType: "uint256",
              },
            ],
          },
          { name: "exists", type: "bool", internalType: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCurrentAccrualIndices",
    inputs: [
      { name: "assetAddress", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HubSpokeStructs.AccrualIndices",
        components: [
          { name: "deposited", type: "uint256", internalType: "uint256" },
          { name: "borrowed", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getGlobalBalance",
    inputs: [
      { name: "assetAddress", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HubSpokeStructs.VaultAmount",
        components: [
          { name: "deposited", type: "uint256", internalType: "uint256" },
          { name: "borrowed", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getInterestAccrualIndexPrecision",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getInterestAccrualIndices",
    inputs: [
      { name: "assetAddress", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HubSpokeStructs.AccrualIndices",
        components: [
          { name: "deposited", type: "uint256", internalType: "uint256" },
          { name: "borrowed", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserBalance",
    inputs: [
      { name: "vaultOwner", type: "address", internalType: "address" },
      { name: "assetAddress", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HubSpokeStructs.VaultAmount",
        components: [
          { name: "deposited", type: "uint256", internalType: "uint256" },
          { name: "borrowed", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liquidation",
    inputs: [
      { name: "vault", type: "address", internalType: "address" },
      {
        name: "assetRepayAddresses",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "assetRepayAmounts",
        type: "uint256[]",
        internalType: "uint256[]",
      },
      {
        name: "assetReceiptAddresses",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "assetReceiptAmounts",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "localCompleteAction",
    inputs: [
      {
        name: "params",
        type: "tuple",
        internalType: "struct Hub.ActionPayloadN",
        components: [
          { name: "action", type: "uint8", internalType: "uint8" },
          { name: "sender", type: "address", internalType: "address" },
          { name: "assetAddress", type: "address", internalType: "address" },
          { name: "assetAmount", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "localCompleteActionNative",
    inputs: [
      {
        name: "params",
        type: "tuple",
        internalType: "struct Hub.ActionPayloadN",
        components: [
          { name: "action", type: "uint8", internalType: "uint8" },
          { name: "sender", type: "address", internalType: "address" },
          { name: "assetAddress", type: "address", internalType: "address" },
          { name: "assetAmount", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "normalizeAmount",
    inputs: [
      { name: "denormalizedAmount", type: "uint256", internalType: "uint256" },
      {
        name: "interestAccrualIndex",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "round",
        type: "uint8",
        internalType: "enum HubSpokeStructs.Round",
      },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "receiveWormholeMessages",
    inputs: [
      { name: "payload", type: "bytes", internalType: "bytes" },
      { name: "additionalVaas", type: "bytes[]", internalType: "bytes[]" },
      { name: "sourceAddress", type: "bytes32", internalType: "bytes32" },
      { name: "sourceChain", type: "uint16", internalType: "uint16" },
      { name: "deliveryHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "registerAsset",
    inputs: [
      { name: "assetAddress", type: "address", internalType: "address" },
      {
        name: "collateralizationRatioDeposit",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "collateralizationRatioBorrow",
        type: "uint256",
        internalType: "uint256",
      },
      { name: "ratePrecision", type: "uint64", internalType: "uint64" },
      { name: "kinks", type: "uint256[]", internalType: "uint256[]" },
      { name: "rates", type: "uint256[]", internalType: "uint256[]" },
      { name: "reserveFactor", type: "uint256", internalType: "uint256" },
      { name: "reservePrecision", type: "uint256", internalType: "uint256" },
      { name: "pythId", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "callerConfirmation", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setMockPythFeed",
    inputs: [
      { name: "id", type: "bytes32", internalType: "bytes32" },
      { name: "price", type: "int64", internalType: "int64" },
      { name: "conf", type: "uint64", internalType: "uint64" },
      { name: "expo", type: "int32", internalType: "int32" },
      { name: "emaPrice", type: "int64", internalType: "int64" },
      { name: "emaConf", type: "uint64", internalType: "uint64" },
      { name: "publishTime", type: "uint64", internalType: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setOraclePrice",
    inputs: [
      { name: "oracleId", type: "bytes32", internalType: "bytes32" },
      {
        name: "price",
        type: "tuple",
        internalType: "struct HubSpokeStructs.Price",
        components: [
          { name: "price", type: "int64", internalType: "int64" },
          { name: "conf", type: "uint64", internalType: "uint64" },
          { name: "expo", type: "int32", internalType: "int32" },
          { name: "publishTime", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRegisteredSender",
    inputs: [
      { name: "sourceChain", type: "uint16", internalType: "uint16" },
      { name: "sourceAddress", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenBridge",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract ITokenBridge" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "wormhole",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract IWormhole" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "wormholeRelayer",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract IWormholeRelayer" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  { type: "error", name: "AccessControlBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "neededRole", type: "bytes32", internalType: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "NotAnEvmAddress",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
  },
] as const;
