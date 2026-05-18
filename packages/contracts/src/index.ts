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

export const DEFAULT_RPC_URLS = {
  43113: "https://api.avax-test.network/ext/bc/C/rpc",
  5042002: "https://rpc.testnet.arc.network",
} as const satisfies Record<(typeof SUPPORTED_CHAIN_IDS)[number], string>;

export const CIRCLE_GATEWAY = {
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  burnIntentAuthority: "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  testnetApiBaseUrl: "https://gateway-api-testnet.circle.com/v1",
} as const satisfies Record<string, Address | string>;

export const PYTH_FEED_IDS = {
  usdUsdc: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  eurUsd: "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
  jpyUsd: "0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52",
  mxnUsd: "0xe13b1c1ffb32f34e1be9545583f01ef385fde7f42ee66049d30570dc866b77ca",
  chfUsd: "0x0b1e3297e69f162877b577b0d6a47a0d63b2392bc8499e6540da4187a63e28f8",
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
  fujiToArcSpotFxChfc:
    "0x84d69f49ece767181be6ee9d8706e5007bc8dda02fed481bb21446760d3c3e4f",
} as const satisfies Record<string, Hex>;

export type SpotFxSymbol = "EURC" | "JPYC" | "MXNB" | "CHFC";
export type BuFxPerpMarketSymbol = "FX-USD-JPY" | "FX-USD-MXN" | "FX-USD-CHF";
export type ArcPerpMarketSymbol = "EURC/USDC" | "tJPYC/USDC" | "tMXNB/USDC" | "tCHFC/USDC";

export interface TokenRegistry {
  usdc?: Address;
  eurc?: Address;
  jpyc?: Address;
  mxnb?: Address;
  chfc?: Address;
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

export interface BuFxProtocolPerpMarket {
  sourceChainId: 43113;
  chainId: 5042002;
  hubId: "arc-testnet";
  marketId: Hex;
  routeId: Hex;
  baseToken: "usdc";
  quoteToken: "jpyc" | "mxnb" | "chfc";
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
  baseToken: "eurc" | "jpyc" | "mxnb" | "chfc";
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
  },
  919: {
    name: "Mode Sepolia",
    chainId: 919,
    tokens: {},
    telarana: {},
    bufx: {},
    perps: {},
    bento: {},
  },
  5042002: {
    name: "Arc Testnet",
    chainId: 5042002,
    gatewayDomain: 26,
    tokens: {
      usdc: "0x3600000000000000000000000000000000000000",
      eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      jpyc: "0xB176f6E0c8ecc2be208F72Ad34c54e5F10F1882a",
      mxnb: "0xe8F76f90553F50E76731afbeF1ac83a9152fFBEb",
      chfc: "0x249DBFd4ac17247Cf10098F6C3937F90570b5750",
    },
    telarana: {
      fxSpotExecutor: "0x37ccDa89628Fd3Cc1f8ef5e45D8725c4e3a59542",
      telaranaGatewayHubHook: "0x74E894aFf25c89d707873347cd2554d30E0541fa",
      fxHubMessageReceiver: "0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C",
      fxGatewayHook: "0x2931C50745334d6DFf9eC4E3106fE05b49717DF1",
      fxOracle: "0x77b3A3B420dB98B01085b8C46a753Ed9879e2865",
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
    perps: {
      clearinghouse: "0x25cDf2ad4Fd446e85273c4D7C77a03F22C742865",
      marginAccount: "0x1869D0253286dF29ce0AB8d29207772C7fD9dc35",
      fundingEngine: "0x725822e8BC6edbcBa52914149e25f2671290C6D2",
      healthChecker: "0x9cc0D71e2Af1532e74C2Af8aE7248ACB501039d5",
      liquidationEngine: "0x01f71c1E74350633bBC9d554ca35DA40412DCFB7",
      orderSettlement: "0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565",
    },
    bento: {},
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
  CHFC: {
    sourceChainId: 43113,
    destinationChainId: 5042002,
    routeId: LIVE_ROUTE_IDS.fujiToArcSpotFxChfc,
    action: "SPOT_FX",
    tokenOut: CONTRACTS[5042002].tokens.chfc!,
    pythFeedId: PYTH_FEED_IDS.chfUsd,
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
  "FX-USD-CHF": {
    sourceChainId: 43113,
    chainId: 5042002,
    hubId: "arc-testnet",
    marketId: "0xd9e93a29607ef7c3b40aa9421d7c2e018ac99f932ae857a01db69ba0a7587d26",
    routeId: LIVE_ROUTE_IDS.fujiToArcMintToHubUsdc,
    baseToken: "usdc",
    quoteToken: "chfc",
    pythFeedId: PYTH_FEED_IDS.chfUsd,
    feeConfig: {
      spotFeeBps: 5,
      rfqFeeBps: 3,
      perpLiquidityFeeBps: 8,
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
  "tMXNB/USDC": {
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
  "tCHFC/USDC": {
    chainId: 5042002,
    marketId: "0x992a2a93cd7a43a9ca827907f708a00ef88e9757e8aadab780ec4f58b161c7dd",
    baseToken: "chfc",
    quoteToken: "usdc",
    pythFeedId: PYTH_FEED_IDS.chfUsd,
    config: {
      ...ARC_PERP_DEFAULT_CONFIG,
      maxOpenInterestUsd: "500000000",
      maxSkewUsd: "500000000",
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
