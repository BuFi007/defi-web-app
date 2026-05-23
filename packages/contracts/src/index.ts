import type { Address, Hex } from "viem";

import type { ChainId } from "@bufi/shared-types";

// Per-product manifest barrels — merged in from the 3 backend worktrees.
// Consumers can import directly (`@bufi/contracts/bento`, `/perps`,
// `/telarana`) for tighter typing OR namespace via this re-export.
export * as Bento from "./bento";
export * as Telarana from "./telarana";
export * as Perps from "./perps-deployments";

export {
  buFxFeeCollectorAbi,
} from "./abis/BuFxFeeCollector";
export {
  buFxFeeConfigAbi,
} from "./abis/BuFxFeeConfig";
export {
  buFxTelaranaRequestRouterAbi,
} from "./abis/BuFxTelaranaRequestRouter";
export {
  buFxVenueRequestRouterAbi,
} from "./abis/BuFxVenueRequestRouter";
export {
  fxSpotExecutorAbi,
} from "./abis/FxSpotExecutor";
export {
  FxHubMessageReceiverAbi,
} from "./abis/FxHubMessageReceiver";
export {
  FxLiquidatorAbi,
} from "./abis/FxLiquidator";
export {
  FxFundingEngineAbi,
} from "./abis/FxFundingEngine";
export {
  FxHealthCheckerAbi,
} from "./abis/FxHealthChecker";
export {
  FxLiquidationEngineAbi,
} from "./abis/FxLiquidationEngine";
export {
  FxMarginAccountAbi,
} from "./abis/FxMarginAccount";
export {
  FxMarketRegistryAbi,
} from "./abis/FxMarketRegistry";
export {
  FxOrderSettlementAbi,
} from "./abis/FxOrderSettlement";
export {
  FxOracleAbi,
} from "./abis/FxOracle";
export {
  fxPrivacyEntrypointAbi,
} from "./abis/FxPrivacyEntrypoint";
export {
  FxPerpClearinghouseAbi,
} from "./abis/FxPerpClearinghouse";
export {
  FxPerpMarketAbi,
} from "./abis/FxPerpMarket";
export {
  FxReceiptAbi,
} from "./abis/FxReceipt";
export {
  TelaranaGatewayHubHookAbi,
} from "./abis/TelaranaGatewayHubHook";

export const SUPPORTED_CHAIN_IDS = [43113, 5042002] as const;

export const CHAIN_IDS = {
  avalancheFuji: 43113,
  arcTestnet: 5042002,
} as const;

export const RPC_ENV_BY_CHAIN = {
  43113: "PONDER_RPC_URL_AVAX_FUJI",
  5042002: "PONDER_RPC_URL_ARC_TESTNET",
} as const satisfies Record<(typeof SUPPORTED_CHAIN_IDS)[number], string>;

// Hardcoded fallbacks — kept so `getRpcUrl()` works in pure-dev contexts even
// when no env is set. Production deploys should override via the matching env
// var (`AVALANCHE_FUJI_RPC_URL`, `ARC_TESTNET_RPC_URL`) declared in @bufi/env.
// PublicNode for Fuji — the canonical `api.avax-test.network` endpoint
// omits Access-Control-Allow-Origin, which makes any browser-side viem
// call (balance reads, market state) error out under CORS. PublicNode
// mirrors the same chain state and serves `Access-Control-Allow-Origin: *`.
// Override via `AVALANCHE_FUJI_RPC_URL` for staging/prod RPC pinning.
const HARDCODED_DEFAULT_RPC_URLS = {
  43113: "https://avalanche-fuji-c-chain-rpc.publicnode.com",
  5042002: "https://rpc.testnet.arc.network",
} as const satisfies Record<(typeof SUPPORTED_CHAIN_IDS)[number], string>;

const RPC_OVERRIDE_ENV_BY_CHAIN = {
  43113: "AVALANCHE_FUJI_RPC_URL",
  5042002: "ARC_TESTNET_RPC_URL",
} as const satisfies Record<(typeof SUPPORTED_CHAIN_IDS)[number], string>;

export const DEFAULT_RPC_URLS = {
  get 43113(): string {
    return process.env[RPC_OVERRIDE_ENV_BY_CHAIN[43113]] ?? HARDCODED_DEFAULT_RPC_URLS[43113];
  },
  get 5042002(): string {
    return process.env[RPC_OVERRIDE_ENV_BY_CHAIN[5042002]] ?? HARDCODED_DEFAULT_RPC_URLS[5042002];
  },
} as Record<(typeof SUPPORTED_CHAIN_IDS)[number], string>;

export const CIRCLE_GATEWAY = {
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  burnIntentAuthority: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  testnetApiBaseUrl: "https://gateway-api-testnet.circle.com/v1",
} as const satisfies Record<string, Address | string>;

// Canonical Pyth Hermes feed IDs. Source of truth:
// ~/coding-dojo/fx-telarana/packages/sdk/src/addresses/index.ts.
//
// Five live feeds: usdUsdc (peg sanity), eurUsd (EURC perp), jpyUsd
// (JPYC perp), mxnUsd (MXNB perp), btcUsd (CIRBTC perp), cadUsd
// (QCAD Morpho), audUsd (AUDF — perp listing pending). chfUsd
// dropped — CHFC was inert on Arc and the surface is fully removed.
export const PYTH_FEED_IDS = {
  usdUsdc: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  eurUsd: "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
  jpyUsd: "0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52",
  mxnUsd: "0xe13b1c1ffb32f34e1be9545583f01ef385fde7f42ee66049d30570dc866b77ca",
  btcUsd: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  cadUsd: "0x3112b03a41c910ed446852aacf67118cb1bec67b2cd0b9a214c58cc0eaa2ecca",
  audUsd: "0x67a6f93030420c1c9e3fe37c1ab6b77966af82f995944a9fefce357a22854a80",
} as const satisfies Record<string, Hex>;

export const LIVE_ROUTE_IDS = {
  fujiToArcMintToHubUsdc:
    "0xf78147c98547731be048740d9d9089e6258e5e712e0c66f7b9d9d57d6af3a968",
  arcToFujiMintToHubUsdc:
    "0x1a255f6aaa29b7ffd589c882eda0ab42f2613bfe51f271b6a677b318321a1efb",
  fujiToArcSpotFxEurc:
    "0x4b50d101784ab33ee4adc9ca42080b10cdd2b23d71004a34a9625f3554e97f19",
  fujiToArcSpotFxJpyc:
    "0xda73657812ef2aa4a59ca67e8d757ac98155cf6aac04e6c0a1723b6f2799a47b",
  fujiToArcSpotFxMxnb:
    "0x4e26b194dd0f03e769ec58a34bcd4bbbe88f27d2aa1c502eb50dc20d4569512c",
} as const satisfies Record<string, Hex>;

export type SpotFxSymbol = "EURC" | "JPYC" | "MXNB";
export type BuFxPerpMarketSymbol = "FX-USD-JPY" | "FX-USD-MXN";
// User-facing labels carry NO `t` prefix once the real issuer asset
// exists. The MXNB/USDC perp's on-chain base is still the test
// synthetic at 0xe8F76f90… until fx-telarana migrates the market to
// the real MXNB issuer; the label reflects user intent. CHFC dropped
// entirely (no real CHFC token on Arc; spot + perp surfaces both
// removed).
// tJPYC keeps its t-prefix: there's only one JPYC contract on Arc
// (0xB176f6E0…) and it's the test issuance; the label reflects that
// no canonical JPYC token has been deployed yet. MXNB and CIRBTC have
// real issuer tokens so they don't carry the prefix.
export type ArcPerpMarketSymbol =
  | "EURC/USDC"
  | "tJPYC/USDC"
  | "MXNB/USDC"
  | "CIRBTC/USDC";

export interface TokenRegistry {
  usdc?: Address;
  eurc?: Address;
  jpyc?: Address;
  // `mxnb` is the live issuer-token (0x836F73Fb…) on Arc per the
  // sprint-1 broadcast. The MXNB/USDC perp's on-chain base is still
  // the test synthetic (0xe8F76f90…); the UI references the issuer
  // for balance/transfer flows and the perp redeployment will close
  // the small mismatch.
  mxnb?: Address;
  qcad?: Address;
  cirbtc?: Address;
  audf?: Address;
}

export interface TelaranaContracts {
  fxSpotExecutor?: Address;
  telaranaGatewayHubHook?: Address;
  fxHubMessageReceiver?: Address;
  fxGatewayHook?: Address;
  fxOracle?: Address;
  fxMarketRegistry?: Address;
  fxLiquidator?: Address;
  fxReceiptUsdc?: Address;
  fxReceiptEurc?: Address;
}

export interface BuFxContracts {
  telaranaRequestRouter?: Address;
  venueRequestRouter?: Address;
  feeConfig?: Address;
  feeCollector?: Address;
}

/**
 * Privacy Hook v1 (sprint shipped 2026-05-18). Shielded ERC-20 pools
 * with cross-currency atomic relay via FxFixedRateSwapAdapter. Deployer
 * + scopes are pinned in `fx-telarana/deployments/privacy-hook-{network}.json`;
 * those JSON files are the source of truth and these fields are a
 * subset for runtime consumers.
 *
 * - `entrypoint` is the UUPS proxy (`FxPrivacyEntrypoint`); always
 *   prefer this over the impl address for `deposit / relay /
 *   relayCrossCurrency` calls.
 * - `swapAdapter` is the owner-operated fixed-rate swap that the
 *   entrypoint authorizes for `relayCrossCurrency` (Track B v2, after
 *   the codex round-11 fix). Arc only today; Fuji has same-currency
 *   pools but no swap adapter yet.
 * - `poolUSDC` / `poolEURC` are the per-asset shielded pools; the
 *   entrypoint resolves them via `scopeToPool(scope)` but having them
 *   here lets the UI render pool TVL without an RPC roundtrip.
 * - `commitmentVerifier` / `withdrawalVerifier` are the Groth16 verify
 *   contracts; the SDK uses them transparently via the entrypoint, but
 *   they're listed for completeness + ABI ref.
 *
 * See `@bufi/fx-telarana-sdk/privacy` (PrivacyTradeClient) for the
 * canonical client wrapper around these addresses.
 */
export interface PrivacyContracts {
  entrypoint?: Address;
  entrypointImpl?: Address;
  swapAdapter?: Address;
  poolUSDC?: Address;
  poolEURC?: Address;
  commitmentVerifier?: Address;
  withdrawalVerifier?: Address;
  poseidonT3?: Address;
  poseidonT4?: Address;
}

export interface BuFxProtocolPerpMarket {
  sourceChainId: 43113;
  chainId: 5042002;
  hubId: "arc-testnet";
  marketId: Hex;
  routeId: Hex;
  baseToken: "usdc";
  quoteToken: "jpyc" | "mxnb";
  pythFeedId: Hex;
  feeConfig: {
    spotFeeBps: number;
    rfqFeeBps: number;
    perpLiquidityFeeBps: number;
    referralDiscountBps: number;
    referralShareBps: number;
    enabled: boolean;
  };
}

export interface ArcPerpMarket {
  chainId: 5042002;
  marketId: Hex;
  baseToken: "eurc" | "jpyc" | "mxnb" | "cirbtc";
  quoteToken: "usdc";
  pythFeedId: Hex;
  config: {
    initialMarginBps: number;
    maintenanceMarginBps: number;
    tradingFeeBps: number;
    maxLeverageBps: number;
    maxOpenInterestUsd: string;
    maxSkewUsd: string;
    enabled: boolean;
  };
  fundingConfig: {
    enabled: boolean;
    maxFundingRateBpsPerSecond: number;
    fundingVelocityBps: number;
  };
}

export interface PerpsContracts {
  clearinghouse?: Address;
  marginAccount?: Address;
  fundingEngine?: Address;
  healthChecker?: Address;
  liquidationEngine?: Address;
  orderSettlement?: Address;
  markets?: Partial<Record<string, Address>>;
}

export interface BentoContracts {
  roomFactory?: Address;
  treasury?: Address;
}

export interface ChainContracts {
  name: string;
  chainId: ChainId;
  gatewayDomain?: number;
  tokens: TokenRegistry;
  telarana: TelaranaContracts;
  bufx: BuFxContracts;
  perps: PerpsContracts;
  bento: BentoContracts;
  privacy: PrivacyContracts;
}

export const CONTRACTS: Record<ChainId, ChainContracts> = {
  43113: {
    name: "Avalanche Fuji",
    chainId: 43113,
    gatewayDomain: 1,
    tokens: {
      usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    },
    telarana: {
      fxHubMessageReceiver: "0x7eAdfD0c08dd6544f763285bBD31be14179d594B",
      fxGatewayHook: "0x7dA191bfB85D9F14069228cf618519BFb41f371E",
    },
    bufx: {
      telaranaRequestRouter: "0x46cC11feD4F497C0C091b7bE5a1A21af133c26f1",
      venueRequestRouter: "0x84EE03C52B89B01315C9572520192274b570D2c3",
      feeConfig: "0xa589040434735710aEF173e31e421a2d0a20Dd17",
      feeCollector: "0x1894C8c84F3a8DD1e17B237008a197feD2E299B6",
    },
    perps: {},
    bento: {},
    // Privacy Hook v1 (Option A) on Fuji — shielded USDC pool only;
    // cross-currency relay NOT wired (Track B v2 lives on Arc only).
    // Source: ~/coding-dojo/fx-telarana/deployments/privacy-hook-fuji.json.
    privacy: {
      entrypoint: "0x6d5e3d5be0be2b29d48eda2fa35fa8d787d3c953",
      entrypointImpl: "0xcd04c6e2277a50c93368da77a28ba917083c205a",
      poolUSDC: "0xc490be46d2b87b92f146ab4dd907784d9658ec7f",
      commitmentVerifier: "0x4c4e1ec5dae12a8cbac7ff4187e2c3e5719ac71b",
      withdrawalVerifier: "0x18bd44dd57661ed746e127b378bf1d8e2ae64bf1",
      poseidonT3: "0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93",
      poseidonT4: "0x4443338EF595F44e0121df4C21102677B142ECF0",
    },
  },
  919: {
    name: "Mode Sepolia",
    chainId: 919,
    tokens: {},
    telarana: {},
    bufx: {},
    perps: {},
    bento: {},
    privacy: {},
  },
  5042002: {
    name: "Arc Testnet",
    chainId: 5042002,
    gatewayDomain: 26,
    // Sprint-1 issuer tokens (broadcast 2026-05-21). `mxnb` is now the
    // REAL issuer-token at 0x836F73Fb… per the fx-telarana integration
    // handoff; the previous mxnb slot held the perp's tMXNB test base
    // (0xe8F76f90…), which now lives under `tmxnb` so both are
    // reachable. `chfc` removed — perp is `enabled=false` on-chain.
    tokens: {
      usdc: "0x3600000000000000000000000000000000000000",
      eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      jpyc: "0xB176f6E0c8ecc2be208F72Ad34c54e5F10F1882a",
      mxnb: "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461",
      qcad: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d",
      cirbtc: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
      audf: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
    },
    telarana: {
      fxSpotExecutor: "0x37ccDa89628Fd3Cc1f8ef5e45D8725c4e3a59542",
      telaranaGatewayHubHook: "0x74E894aFf25c89d707873347cd2554d30E0541fa",
      fxHubMessageReceiver: "0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C",
      fxGatewayHook: "0x2931C50745334d6DFf9eC4E3106fE05b49717DF1",
      fxOracle: "0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78",
      fxMarketRegistry: "0x813232259c9b922e7571F15220617C80581f1464",
      fxLiquidator: "0xa50f7D4D4a1A0D3CF418515973545b80E037B379",
      fxReceiptUsdc: "0xdd22365Bba7330BE537c9BC26da9b1b4Db9aC431",
      fxReceiptEurc: "0xF829f57Db8530fa93FCD6e13b00193cbe8cE1493",
    },
    bufx: {
      telaranaRequestRouter: "0xea11AfDc70eD0489346AC9d488C17155384B459c",
      venueRequestRouter: "0xa73208b62AF9a87fb5e2b694B27f510D70e17746",
      feeConfig: "0x746e727E3aa25050c24a80E27E3bAEd9Ec6DdF6C",
      feeCollector: "0x27DbdA42aDb904115cAdE37C949bBF670E0FF09d",
    },
    // Sprint-1 broadcast on Arc Testnet (2026-05-21). Source of truth:
    // ~/coding-dojo/fx-telarana/deployments/perp-stack-5042002.json.
    // Drift here was the second EIP-712 verifyingContract drift surfaced
    // during the Step 3 dogfood — UI signs against this address, matcher
    // verifies against the deployment manifest; mismatch → SignerMismatch.
    perps: {
      clearinghouse: "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A",
      marginAccount: "0x4EB6018F988301417B93cb2b8899D74D42273e96",
      fundingEngine: "0x859bA11A3693895f8B03C31C6AE3b8F04992115B",
      healthChecker: "0xA00Be167609c02F3879138dA8530BC31527c02b8",
      liquidationEngine: "0xF579e265EF1D5E67EfDbb1F20863465E94a9d3eA",
      orderSettlement: "0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC",
    },
    bento: {},
    // Privacy Hook v1 on Arc (sprint 2026-05-18) — shielded USDC + EURC
    // pools + Track B v2 fixed-rate swap adapter for atomic cross-currency
    // relay. `swapAdapter` is the v2 (codex round-11 patched) variant;
    // the deprecated v1 adapter at 0xA1930d3c… is drained + disabled.
    // Source: ~/coding-dojo/fx-telarana/deployments/privacy-hook-arc.json.
    privacy: {
      entrypoint: "0xd11cddd1f04e850d3810a71608a49907c80f2736",
      entrypointImpl: "0x4506441df7960b2cb2b600b0d37dfd3ea79fa92a",
      swapAdapter: "0x3Fa1AcC89DFd52f6692F20b7E49cD58A306C27f2",
      poolUSDC: "0xc11c216c9c7a36848b1d4276d223160c8b51988f",
      poolEURC: "0x7B4582CDE65c8cC00fE24B16dBA60472242d234c",
      commitmentVerifier: "0x9056facd889a94e4acba8cbc4c8a81ed47ba8ea0",
      withdrawalVerifier: "0x7f0326cea0796e31ed38f01b1e8660faad7bb6ee",
      poseidonT3: "0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93",
      poseidonT4: "0x4443338EF595F44e0121df4C21102677B142ECF0",
    },
  },
};

export const SPOT_FX_ROUTES: Record<
  SpotFxSymbol,
  {
    sourceChainId: 43113;
    destinationChainId: 5042002;
    routeId: Hex;
    action: "SPOT_FX";
    tokenOut: Address;
    pythFeedId: Hex;
  }
> = {
  EURC: {
    sourceChainId: 43113,
    destinationChainId: 5042002,
    routeId: LIVE_ROUTE_IDS.fujiToArcSpotFxEurc,
    action: "SPOT_FX",
    tokenOut: CONTRACTS[5042002].tokens.eurc!,
    pythFeedId: PYTH_FEED_IDS.eurUsd,
  },
  JPYC: {
    sourceChainId: 43113,
    destinationChainId: 5042002,
    routeId: LIVE_ROUTE_IDS.fujiToArcSpotFxJpyc,
    action: "SPOT_FX",
    tokenOut: CONTRACTS[5042002].tokens.jpyc!,
    pythFeedId: PYTH_FEED_IDS.jpyUsd,
  },
  MXNB: {
    sourceChainId: 43113,
    destinationChainId: 5042002,
    routeId: LIVE_ROUTE_IDS.fujiToArcSpotFxMxnb,
    action: "SPOT_FX",
    tokenOut: CONTRACTS[5042002].tokens.mxnb!,
    pythFeedId: PYTH_FEED_IDS.mxnUsd,
  },
};

// Source: ../BUFX/deployments/testnet/bufx-telarana-router.generated.json.
export const BUFX_PROTOCOL_PERP_MARKETS: Record<BuFxPerpMarketSymbol, BuFxProtocolPerpMarket> = {
  "FX-USD-JPY": {
    sourceChainId: 43113,
    chainId: 5042002,
    hubId: "arc-testnet",
    marketId: "0xfc3e288cc7282a2306120977dd76aef9f3ec4f90397fd1d4ac04e33d9ad09efb",
    routeId: LIVE_ROUTE_IDS.fujiToArcMintToHubUsdc,
    baseToken: "usdc",
    quoteToken: "jpyc",
    pythFeedId: PYTH_FEED_IDS.jpyUsd,
    feeConfig: {
      spotFeeBps: 5,
      rfqFeeBps: 3,
      perpLiquidityFeeBps: 8,
      referralDiscountBps: 1000,
      referralShareBps: 2000,
      enabled: true,
    },
  },
  "FX-USD-MXN": {
    sourceChainId: 43113,
    chainId: 5042002,
    hubId: "arc-testnet",
    marketId: "0xdc13fbc1a6ecb8104e2831592fb1e849faf65e7a596bfd1926ae1bc585ba2332",
    routeId: LIVE_ROUTE_IDS.fujiToArcMintToHubUsdc,
    baseToken: "usdc",
    quoteToken: "mxnb",
    pythFeedId: PYTH_FEED_IDS.mxnUsd,
    feeConfig: {
      spotFeeBps: 8,
      rfqFeeBps: 5,
      perpLiquidityFeeBps: 10,
      referralDiscountBps: 1000,
      referralShareBps: 2000,
      enabled: true,
    },
  },
};

const ARC_PERP_DEFAULT_CONFIG = {
  initialMarginBps: 500,
  maintenanceMarginBps: 300,
  tradingFeeBps: 5,
  maxLeverageBps: 200_000,
  enabled: true,
} as const;

const ARC_PERP_DEFAULT_FUNDING_CONFIG = {
  enabled: true,
  maxFundingRateBpsPerSecond: 1,
  fundingVelocityBps: 1,
} as const;

// Source: ../fx-telarana/reports/CONFIG_ARC_PHASE_B_E_PERP_MARKETS.md.
//
// Live on Arc (sprint-1 broadcast 2026-05-21,
// ~/coding-dojo/fx-telarana/deployments/perps-config-5042002.json):
//   EURC/USDC, tJPYC/USDC, tMXNB/USDC, CIRBTC/USDC.
// tCHFC/USDC is kept here for SDK shape but is `enabled=false` on-chain
// (the matcher's marketConfig read returns enabled=false; useMarketList
// filters it out). CIRBTC/USDC is intentionally NOT here yet — it's a
// BTC-perp not an FX pair, and adding it requires the cirbtc token in
// TokenRegistry + a btcUsd Pyth feed id; tracked as a follow-up.
export const ARC_PERP_MARKETS: Record<ArcPerpMarketSymbol, ArcPerpMarket> = {
  "EURC/USDC": {
    chainId: 5042002,
    marketId: "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
    baseToken: "eurc",
    quoteToken: "usdc",
    pythFeedId: PYTH_FEED_IDS.eurUsd,
    config: {
      ...ARC_PERP_DEFAULT_CONFIG,
      maxOpenInterestUsd: "1000000000",
      maxSkewUsd: "1000000000",
    },
    fundingConfig: ARC_PERP_DEFAULT_FUNDING_CONFIG,
  },
  "tJPYC/USDC": {
    chainId: 5042002,
    marketId: "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
    baseToken: "jpyc",
    quoteToken: "usdc",
    pythFeedId: PYTH_FEED_IDS.jpyUsd,
    config: {
      ...ARC_PERP_DEFAULT_CONFIG,
      maxOpenInterestUsd: "500000000",
      maxSkewUsd: "500000000",
    },
    fundingConfig: ARC_PERP_DEFAULT_FUNDING_CONFIG,
  },
  "MXNB/USDC": {
    chainId: 5042002,
    marketId: "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
    baseToken: "mxnb",
    quoteToken: "usdc",
    pythFeedId: PYTH_FEED_IDS.mxnUsd,
    config: {
      ...ARC_PERP_DEFAULT_CONFIG,
      maxOpenInterestUsd: "500000000",
      maxSkewUsd: "500000000",
    },
    fundingConfig: ARC_PERP_DEFAULT_FUNDING_CONFIG,
  },
  "CIRBTC/USDC": {
    chainId: 5042002,
    marketId: "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
    baseToken: "cirbtc",
    quoteToken: "usdc",
    pythFeedId: PYTH_FEED_IDS.btcUsd,
    config: {
      ...ARC_PERP_DEFAULT_CONFIG,
      // 250 USDC on-chain (ultra-safe testnet). Operator raises via
      // docs/operator-raise-oi-caps.md before live dogfooding.
      maxOpenInterestUsd: "250000000",
      maxSkewUsd: "250000000",
    },
    fundingConfig: ARC_PERP_DEFAULT_FUNDING_CONFIG,
  },
};

export function getContracts(chainId: ChainId): ChainContracts {
  return loadContracts()[chainId];
}

export function getRpcUrl(chainId: ChainId): string {
  const envName = RPC_ENV_BY_CHAIN[chainId as keyof typeof RPC_ENV_BY_CHAIN];
  const configured = envName ? process.env[envName] : undefined;
  return configured ?? DEFAULT_RPC_URLS[chainId as keyof typeof DEFAULT_RPC_URLS] ?? "";
}

export function loadContracts(): Record<ChainId, ChainContracts> {
  const raw = process.env.CONTRACT_ADDRESSES_JSON;
  if (!raw) return CONTRACTS;
  try {
    const overrides = JSON.parse(raw) as Partial<Record<ChainId, Partial<ChainContracts>>>;
    const merged = structuredClone(CONTRACTS) as Record<ChainId, ChainContracts>;
    for (const [k, v] of Object.entries(overrides)) {
      const chainId = Number(k) as ChainId;
      if (!merged[chainId]) continue;
      const patch = normalizeChainOverride(v as Record<string, unknown>);
      merged[chainId] = deepMerge(
        merged[chainId] as unknown as Record<string, unknown>,
        patch,
      ) as unknown as ChainContracts;
    }
    return merged;
  } catch (e) {
    throw new Error(
      `@bufi/contracts: failed to parse CONTRACT_ADDRESSES_JSON: ${(e as Error).message}`,
    );
  }
}

const PERPS_DEPLOYMENT_MANIFEST_KEYS = {
  FxPerpClearinghouse: "clearinghouse",
  FxMarginAccount: "marginAccount",
  FxFundingEngine: "fundingEngine",
  FxHealthChecker: "healthChecker",
  FxLiquidationEngine: "liquidationEngine",
  FxOrderSettlement: "orderSettlement",
} as const satisfies Record<string, keyof PerpsContracts>;

function normalizeChainOverride(patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  const perps = isRecord(out.perps) ? { ...out.perps } : {};
  let foundFlatPerpsManifestKey = false;

  for (const [manifestKey, perpsKey] of Object.entries(PERPS_DEPLOYMENT_MANIFEST_KEYS)) {
    const value = out[manifestKey];
    if (typeof value !== "string") continue;
    perps[perpsKey] = value;
    delete out[manifestKey];
    foundFlatPerpsManifestKey = true;
  }

  if (foundFlatPerpsManifestKey || isRecord(out.perps)) {
    out.perps = perps;
  }

  return out;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = out[key] as Record<string, unknown> | undefined;
      out[key] = deepMerge(existing ?? {}, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
