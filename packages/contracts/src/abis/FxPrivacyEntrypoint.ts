// Minimal `FxPrivacyEntrypoint` ABI fragments — only the views + writes
// the API and UI actually call. Mirrors the inline ABI in
// `~/coding-dojo/fx-telarana/packages/sdk/src/privacy/services/contractsService.ts`.
//
// Source contract: `~/coding-dojo/fx-telarana/contracts/src/perp/.../FxPrivacyEntrypoint.sol`
// (UUPS proxy; addresses live in `deployments/privacy-hook-{network}.json`).
//
// Why a minimal subset and not the full ABI? The full proxy ABI is
// ~80 entries (initializers, ownership, upgrade controls, etc.). The
// API + UI only ever need the user-facing surface — deposit / relay /
// pool lookups / latest-root. Drift here is caught by the SDK's own
// tests in `privacyTradeClient.test.ts` upstream.

export const fxPrivacyEntrypointAbi = [
  // ---- views ----
  {
    type: "function",
    stateMutability: "view",
    name: "latestRoot",
    inputs: [],
    outputs: [{ name: "_root", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "scopeToPool",
    inputs: [{ name: "_scope", type: "uint256" }],
    outputs: [{ name: "_pool", type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "swapAdapter",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // ---- writes ----
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "deposit",
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_precommitment", type: "uint256" },
    ],
    outputs: [{ name: "_commitment", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "relay",
    inputs: [
      {
        name: "_w",
        type: "tuple",
        components: [
          { name: "processooor", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
      {
        name: "_p",
        type: "tuple",
        components: [
          { name: "pA", type: "uint256[2]" },
          { name: "pB", type: "uint256[2][2]" },
          { name: "pC", type: "uint256[2]" },
          { name: "pubSignals", type: "uint256[8]" },
        ],
      },
      { name: "_scope", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "relayCrossCurrency",
    inputs: [
      {
        name: "_w",
        type: "tuple",
        components: [
          { name: "processooor", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
      {
        name: "_p",
        type: "tuple",
        components: [
          { name: "pA", type: "uint256[2]" },
          { name: "pB", type: "uint256[2][2]" },
          { name: "pC", type: "uint256[2]" },
          { name: "pubSignals", type: "uint256[8]" },
        ],
      },
      { name: "_scope", type: "uint256" },
    ],
    outputs: [],
  },
  // ---- events (Ponder needs these for indexing) ----
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "depositor", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "commitment", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Relayed",
    inputs: [
      { name: "pool", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CrossCurrencyRelayed",
    inputs: [
      { name: "fromPool", type: "address", indexed: true },
      { name: "toAsset", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
] as const;
