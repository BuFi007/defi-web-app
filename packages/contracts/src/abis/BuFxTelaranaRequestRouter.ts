export const buFxTelaranaRequestRouterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "authorizedSubmitter",
    "inputs": [
      {
        "name": "submitter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "authorized",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelTelaranaRequest",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "gatewayMintContext",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "context",
        "type": "tuple",
        "internalType": "struct ITelaranaGatewayHubHook.GatewayMintContext",
        "components": [
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "action",
            "type": "uint8",
            "internalType": "enum ITelaranaGatewayHubHook.GatewayHubAction"
          },
          {
            "name": "sourceDepositor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceSigner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minAmountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spotRouteId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "metadataRef",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setAuthorizedSubmitter",
    "inputs": [
      {
        "name": "submitter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "authorized",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTelaranaRoute",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "route",
        "type": "tuple",
        "internalType": "struct BuFxRequestTypes.TelaranaRoute",
        "components": [
          {
            "name": "sourceDomain",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "destinationDomain",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "sourceChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sourceUsdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "destinationUsdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "telaranaReceiver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataRef",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitTelaranaRequest",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct BuFxRequestTypes.TelaranaRequest",
        "components": [
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "action",
            "type": "uint8",
            "internalType": "enum BuFxRequestTypes.HubAction"
          },
          {
            "name": "trader",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceSigner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxExecutionFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spot",
            "type": "tuple",
            "internalType": "struct BuFxRequestTypes.SpotRequest",
            "components": [
              {
                "name": "spotRouteId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "tokenOut",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "minAmountOut",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "referrer",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "campaignId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "metadata",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "telaranaReceipt",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "receipt",
        "type": "tuple",
        "internalType": "struct BuFxRequestTypes.TelaranaReceipt",
        "components": [
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum BuFxRequestTypes.RequestState"
          },
          {
            "name": "action",
            "type": "uint8",
            "internalType": "enum BuFxRequestTypes.HubAction"
          },
          {
            "name": "trader",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceSigner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxExecutionFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spotRouteId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minAmountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "referrer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "campaignId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "metadata",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "telaranaRequestState",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "state",
        "type": "uint8",
        "internalType": "enum BuFxRequestTypes.RequestState"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "telaranaRoute",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "route",
        "type": "tuple",
        "internalType": "struct BuFxRequestTypes.TelaranaRoute",
        "components": [
          {
            "name": "sourceDomain",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "destinationDomain",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "sourceChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sourceUsdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "destinationUsdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "telaranaReceiver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataRef",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwner",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AuthorizedSubmitterUpdated",
    "inputs": [
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "authorized",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnerTransferred",
    "inputs": [
      {
        "name": "oldOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TelaranaGatewayMintContextPrepared",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "routeId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "telaranaGatewayHook",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "gatewayAction",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ITelaranaGatewayHubHook.GatewayHubAction"
      },
      {
        "name": "sourceDepositor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "sourceSigner",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "spotRouteId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "metadataRef",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TelaranaRequestCancelled",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "routeId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "trader",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TelaranaRequestSubmitted",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "routeId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "trader",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "action",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BuFxRequestTypes.HubAction"
      },
      {
        "name": "sourceSigner",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "maxExecutionFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "spotRouteId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "referrer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "campaignId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "telaranaReceiver",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TelaranaRouteConfigured",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sourceDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "destinationDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "sourceChainId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "destinationChainId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "sourceUsdc",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "destinationUsdc",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "telaranaReceiver",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "metadataRef",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DuplicateRequest",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExpiredRequest",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRoute",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSpotRequest",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RouteDisabled",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "SameDomain",
    "inputs": [
      {
        "name": "domain",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnauthorizedRequestCanceller",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnauthorizedSubmitter",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "trader",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sourceSigner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownRequest",
    "inputs": [
      {
        "name": "requestId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
