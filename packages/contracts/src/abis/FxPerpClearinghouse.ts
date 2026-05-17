// SPDX-License-Identifier: Apache-2.0
// Minimal Phase B ABI synced to fx-telarana/contracts/src/perp/FxPerpClearinghouse.sol.
export const FxPerpClearinghouseAbi = [
  {
    type: "event",
    name: "PositionIncreased",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "trader", type: "address", indexed: true, internalType: "address" },
      { name: "sizeDeltaE18", type: "int256", indexed: false, internalType: "int256" },
      { name: "resultingSizeE18", type: "int256", indexed: false, internalType: "int256" },
      { name: "entryPriceE18", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "marginReserved", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "fee", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionDecreased",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "trader", type: "address", indexed: true, internalType: "address" },
      { name: "sizeDeltaE18", type: "int256", indexed: false, internalType: "int256" },
      { name: "resultingSizeE18", type: "int256", indexed: false, internalType: "int256" },
      { name: "priceE18", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "marginReleased", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "pnl", type: "int256", indexed: false, internalType: "int256" },
      { name: "badDebt", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "marketConfig",
    inputs: [{ name: "marketId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IFxPerpClearinghouse.MarketConfig",
        components: [
          { name: "baseToken", type: "address", internalType: "address" },
          { name: "enabled", type: "bool", internalType: "bool" },
          { name: "initialMarginBps", type: "uint16", internalType: "uint16" },
          { name: "maintenanceMarginBps", type: "uint16", internalType: "uint16" },
          { name: "tradingFeeBps", type: "uint16", internalType: "uint16" },
          { name: "maxLeverageBps", type: "uint32", internalType: "uint32" },
          { name: "maxOpenInterestUsd", type: "uint256", internalType: "uint256" },
          { name: "maxSkewUsd", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "position",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IFxPerpClearinghouse.Position",
        components: [
          { name: "sizeE18", type: "int256", internalType: "int256" },
          { name: "entryPriceE18", type: "uint256", internalType: "uint256" },
          { name: "marginReserved", type: "uint256", internalType: "uint256" },
          { name: "lastFundingVersion", type: "uint64", internalType: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "openOrIncrease",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
      { name: "sizeDeltaE18", type: "int256", internalType: "int256" },
      { name: "maxFee", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "positionKey", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decreaseOrClose",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
      { name: "sizeDeltaE18", type: "int256", internalType: "int256" },
    ],
    outputs: [{ name: "marginReleased", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "quoteFee",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
      { name: "trader", type: "address", internalType: "address" },
      { name: "sizeDeltaE18", type: "int256", internalType: "int256" },
    ],
    outputs: [
      { name: "fee", type: "uint256", internalType: "uint256" },
      { name: "priceE18", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;
