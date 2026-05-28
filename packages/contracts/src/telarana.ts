/**
 * Telarana lending registry.
 *
 * Source of truth for the Morpho-Blue-backed FX money market that lives on
 * the Avalanche Fuji + Arc Testnet hubs. Deployment manifests under
 * `packages/contracts/deployments/telarana-*.json` are the canonical
 * addresses; this module imports them so downstream consumers don't have
 * to read JSON at runtime.
 *
 * @see ./abis/FxMarketRegistry — borrow / supply / repay / withdraw surface.
 * @see ./abis/FxOracle         — getMid (collateral, loan) → (midE18, publishedAt).
 * @see ./abis/FxLiquidator     — liquidator entry point.
 * @see ./abis/MorphoOracleAdapter — IOracle.price() at 36 dp, per market.
 */
import type { Address, Hex } from "viem";

import { FxLiquidatorAbi } from "./abis/FxLiquidator";
import { FxMarketRegistryAbi } from "./abis/FxMarketRegistry";
import { FxOracleAbi } from "./abis/FxOracle";
import { MorphoOracleAdapterAbi } from "./abis/MorphoOracleAdapter";

import telaranaArcDeployment from "../deployments/telarana-arc-testnet.json" assert { type: "json" };
import telaranaFujiDeployment from "../deployments/telarana-avalanche-fuji.json" assert { type: "json" };

export const TELARANA_ABIS = {
  FxMarketRegistry: FxMarketRegistryAbi,
  FxOracle: FxOracleAbi,
  FxLiquidator: FxLiquidatorAbi,
  MorphoOracleAdapter: MorphoOracleAdapterAbi,
} as const;

/** Contracts that every Telarana hub must define. Required by callers
 *  like `LENDING_HUBS` (chains.ts) and `staticMarkets()`. */
export type TelaranaRequiredContract =
  | "FxSpoke"
  | "FxHubMessageReceiver"
  | "FxGatewayHook"
  | "FxMarketRegistry"
  | "FxOracle"
  | "MorphoOracleAdapterM1"
  | "MorphoOracleAdapterM2"
  | "FxReceiptEURC"
  | "FxReceiptUSDC"
  | "FxLiquidator"
  | "MorphoBlue"
  | "IrmMock";

/** Contracts that are only present after the relevant deploy lands.
 *  Callers must null-check before use. */
export type TelaranaOptionalContract =
  // M3 + M4 oracle adapters: deployed by the per-chain non-EURC market
  // scripts (`DeployFujiMxnbMarkets.s.sol` on Fuji, `DeployArcAudfMarkets.s.sol`
  // on Arc). Absent until the script broadcasts → market is skipped in the
  // static fallback (the live registry read still picks it up via
  // `listPools()`).
  | "MorphoOracleAdapterM3"
  | "MorphoOracleAdapterM4"
  // M5 + M6 oracle adapters (JPYC markets on Fuji).
  | "MorphoOracleAdapterM5"
  | "MorphoOracleAdapterM6"
  // Per-chain fresh FxOracle wired for the non-EURC asset; the original
  // FxOracle is owned by FxTimelock and not retrofittable.
  | "FxOracleMxnb"
  | "FxOracleAudf"
  | "FxOracleJpyc"
  | "FxReceiptMXNB"
  | "FxReceiptAUDF"
  | "FxReceiptJPYC";

export type TelaranaContractName =
  | TelaranaRequiredContract
  | TelaranaOptionalContract;

export type TelaranaHubChainId = 43113 | 5042002;
export type TelaranaHubName = "fuji" | "arc";

/** Stablecoin symbols that may appear as Telarana loan or collateral
 *  legs. Extend when a new market is added to the registry. */
export type TelaranaMarketSymbol = "USDC" | "EURC" | "MXNB" | "AUDF" | "JPYC";

/** Canonical market keys, mirroring `deployments/*.marketIds`. The M3/M4
 *  slots are per-chain: MXNB on Fuji, AUDF on Arc. The type stays a closed
 *  union so callers can exhaust it. */
export type TelaranaMarketKey =
  | "M1_EURC_USDC"
  | "M2_USDC_EURC"
  | "M3_MXNB_USDC"
  | "M4_USDC_MXNB"
  | "M3_AUDF_USDC"
  | "M4_USDC_AUDF"
  | "M5_JPYC_USDC"
  | "M6_USDC_JPYC";

export interface TelaranaMarket {
  /** Morpho-Blue market id (bytes32) computed from MarketParams. */
  id: Hex;
  /** Canonical key in deployments/*.marketIds (e.g. M1_EURC_USDC). */
  key: TelaranaMarketKey;
  loanSymbol: TelaranaMarketSymbol;
  collateralSymbol: TelaranaMarketSymbol;
  loanToken: Address;
  collateralToken: Address;
  /** Per-market Morpho oracle adapter that wraps the global FxOracle. */
  morphoOracleAdapter: Address;
  /** Immutable LLTV from MarketParams, in WAD (1e18). Sourced from the
   *  deployment manifest's `marketLltvs[key]`. Falls back to 0.86e18 if
   *  the manifest omits the entry (all M1-M4 ship at 0.86 today; this
   *  fallback exists so an older manifest can't crash the loader). */
  lltv: bigint;
}

interface TelaranaDeployment {
  chainId: TelaranaHubChainId;
  hubName: TelaranaHubName;
  hubLabel: string;
  contracts: Record<TelaranaRequiredContract, Address> &
    Partial<Record<TelaranaOptionalContract, Address>>;
  marketIds: Partial<Record<TelaranaMarketKey, Hex>>;
  markets: TelaranaMarket[];
}

function asAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`telarana deployment: expected address, got ${String(value)}`);
  }
  return value as Address;
}

function asHex(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`telarana deployment: expected hex string, got ${String(value)}`);
  }
  return value as Hex;
}

function tryHex(value: unknown): Hex | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return /^0x[0-9a-fA-F]+$/.test(value) ? (value as Hex) : null;
}

function tryAddress(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/** LLTV fallback when the manifest omits a marketLltvs entry. Every
 *  M1-M4 market on Fuji + Arc ships at 0.86e18 per the deploy scripts;
 *  this keeps the loader working if a future manifest forgets to fill
 *  the new field. */
const DEFAULT_LLTV_WAD = 860_000_000_000_000_000n;

function lltvFromManifest(
  marketLltvs: Record<string, string> | undefined,
  key: TelaranaMarketKey,
): bigint {
  const raw = marketLltvs?.[key];
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_LLTV_WAD;
  try {
    return BigInt(raw);
  } catch {
    return DEFAULT_LLTV_WAD;
  }
}

function buildDeployment(
  raw: typeof telaranaArcDeployment | typeof telaranaFujiDeployment,
  hubName: TelaranaHubName,
  hubLabel: string,
): TelaranaDeployment {
  const contracts = raw.contracts as Record<string, string>;
  const marketIds = raw.marketIds as Record<string, string>;
  const marketLltvs = (raw as { marketLltvs?: Record<string, string> })
    .marketLltvs;
  const external = (raw.external ?? {}) as Record<string, unknown>;
  const loanUSDC = asAddress(external.USDC);
  // Fuji has no native Circle EURC deployment — fall back to the MockEURC
  // shipped under contracts so the manifest loader doesn't crash at boot.
  const loanEURC = asAddress(external.EURC ?? contracts.MockEURC);
  // M3/M4 are per-chain non-EURC markets:
  //   * Fuji  → MXNB (Bitso testnet issuer)
  //   * Arc   → AUDF (Forte testnet issuer)
  // Both keep the same numeric slot in deployments; the symbol differs.
  const loanMXNB = tryAddress(external.MXNB);
  const loanAUDF = tryAddress(external.AUDF);
  // M5/M6 are JPYC markets (Fuji only for now).
  const loanJPYC = tryAddress(external.JPYC);

  const adapterM3 = tryAddress(contracts.MorphoOracleAdapterM3);
  const adapterM4 = tryAddress(contracts.MorphoOracleAdapterM4);
  const adapterM5 = tryAddress(contracts.MorphoOracleAdapterM5);
  const adapterM6 = tryAddress(contracts.MorphoOracleAdapterM6);
  const m3MxnbId = tryHex(marketIds.M3_MXNB_USDC);
  const m4MxnbId = tryHex(marketIds.M4_USDC_MXNB);
  const m3AudfId = tryHex(marketIds.M3_AUDF_USDC);
  const m4AudfId = tryHex(marketIds.M4_USDC_AUDF);
  const m5JpycId = tryHex(marketIds.M5_JPYC_USDC);
  const m6JpycId = tryHex(marketIds.M6_USDC_JPYC);

  const markets: TelaranaMarket[] = [
    // Morpho M1 is EURC borrowed against USDC collateral; M2 is the inverse.
    // We pin loan/collateral so the SDK doesn't have to re-read paramsOf().
    {
      id: asHex(marketIds.M1_EURC_USDC ?? ""),
      key: "M1_EURC_USDC",
      loanSymbol: "EURC",
      collateralSymbol: "USDC",
      loanToken: loanEURC,
      collateralToken: loanUSDC,
      morphoOracleAdapter: asAddress(contracts.MorphoOracleAdapterM1),
      lltv: lltvFromManifest(marketLltvs, "M1_EURC_USDC"),
    },
    {
      id: asHex(marketIds.M2_USDC_EURC ?? ""),
      key: "M2_USDC_EURC",
      loanSymbol: "USDC",
      collateralSymbol: "EURC",
      loanToken: loanUSDC,
      collateralToken: loanEURC,
      morphoOracleAdapter: asAddress(contracts.MorphoOracleAdapterM2),
      lltv: lltvFromManifest(marketLltvs, "M2_USDC_EURC"),
    },
  ];

  // M3 + M4 only register once the per-chain non-EURC deploy script has
  // run AND the manifest carries the marketId, the adapter address, and
  // the loan token in `external`. All three pieces are mutually dependent
  // — partial config would mis-route reads, so we skip the market entirely
  // when any are missing.
  if (loanMXNB && adapterM3 && m3MxnbId) {
    markets.push({
      id: m3MxnbId,
      key: "M3_MXNB_USDC",
      loanSymbol: "MXNB",
      collateralSymbol: "USDC",
      loanToken: loanMXNB,
      collateralToken: loanUSDC,
      morphoOracleAdapter: adapterM3,
      lltv: lltvFromManifest(marketLltvs, "M3_MXNB_USDC"),
    });
  }
  if (loanMXNB && adapterM4 && m4MxnbId) {
    markets.push({
      id: m4MxnbId,
      key: "M4_USDC_MXNB",
      loanSymbol: "USDC",
      collateralSymbol: "MXNB",
      loanToken: loanUSDC,
      collateralToken: loanMXNB,
      morphoOracleAdapter: adapterM4,
      lltv: lltvFromManifest(marketLltvs, "M4_USDC_MXNB"),
    });
  }
  if (loanAUDF && adapterM3 && m3AudfId) {
    markets.push({
      id: m3AudfId,
      key: "M3_AUDF_USDC",
      loanSymbol: "AUDF",
      collateralSymbol: "USDC",
      loanToken: loanAUDF,
      collateralToken: loanUSDC,
      morphoOracleAdapter: adapterM3,
      lltv: lltvFromManifest(marketLltvs, "M3_AUDF_USDC"),
    });
  }
  if (loanAUDF && adapterM4 && m4AudfId) {
    markets.push({
      id: m4AudfId,
      key: "M4_USDC_AUDF",
      loanSymbol: "USDC",
      collateralSymbol: "AUDF",
      loanToken: loanUSDC,
      collateralToken: loanAUDF,
      morphoOracleAdapter: adapterM4,
      lltv: lltvFromManifest(marketLltvs, "M4_USDC_AUDF"),
    });
  }

  // JPYC markets (M5 + M6) — Fuji only for now.
  if (loanJPYC && adapterM5 && m5JpycId) {
    markets.push({
      id: m5JpycId,
      key: "M5_JPYC_USDC",
      loanSymbol: "JPYC",
      collateralSymbol: "USDC",
      loanToken: loanJPYC,
      collateralToken: loanUSDC,
      morphoOracleAdapter: adapterM5,
      lltv: lltvFromManifest(marketLltvs, "M5_JPYC_USDC"),
    });
  }
  if (loanJPYC && adapterM6 && m6JpycId) {
    markets.push({
      id: m6JpycId,
      key: "M6_USDC_JPYC",
      loanSymbol: "USDC",
      collateralSymbol: "JPYC",
      loanToken: loanUSDC,
      collateralToken: loanJPYC,
      morphoOracleAdapter: adapterM6,
      lltv: lltvFromManifest(marketLltvs, "M6_USDC_JPYC"),
    });
  }

  return {
    chainId: raw.chainId as TelaranaHubChainId,
    hubName,
    hubLabel,
    contracts: Object.fromEntries(
      Object.entries(contracts).map(([k, v]) => [k, asAddress(v)]),
    ) as Record<TelaranaRequiredContract, Address> &
      Partial<Record<TelaranaOptionalContract, Address>>,
    marketIds: {
      M1_EURC_USDC: asHex(marketIds.M1_EURC_USDC ?? ""),
      M2_USDC_EURC: asHex(marketIds.M2_USDC_EURC ?? ""),
      ...(m3MxnbId ? { M3_MXNB_USDC: m3MxnbId } : {}),
      ...(m4MxnbId ? { M4_USDC_MXNB: m4MxnbId } : {}),
      ...(m3AudfId ? { M3_AUDF_USDC: m3AudfId } : {}),
      ...(m4AudfId ? { M4_USDC_AUDF: m4AudfId } : {}),
      ...(m5JpycId ? { M5_JPYC_USDC: m5JpycId } : {}),
      ...(m6JpycId ? { M6_USDC_JPYC: m6JpycId } : {}),
    },
    markets,
  };
}

export const TELARANA_DEPLOYMENTS: Record<TelaranaHubChainId, TelaranaDeployment> = {
  43113: buildDeployment(telaranaFujiDeployment, "fuji", "Avalanche Fuji"),
  5042002: buildDeployment(telaranaArcDeployment, "arc", "Arc Testnet"),
};

export const TELARANA_MARKETS: Record<TelaranaHubChainId, TelaranaMarket[]> = {
  43113: TELARANA_DEPLOYMENTS[43113].markets,
  5042002: TELARANA_DEPLOYMENTS[5042002].markets,
};

export function getTelaranaAddress(
  chainId: TelaranaHubChainId,
  contract: TelaranaContractName,
): Address {
  const deployment = TELARANA_DEPLOYMENTS[chainId];
  if (!deployment) throw new Error(`unknown telarana chainId ${chainId}`);
  const address = deployment.contracts[contract];
  if (!address) throw new Error(`telarana ${chainId}: missing address for ${contract}`);
  return address;
}

export function getTelaranaMarket(
  chainId: TelaranaHubChainId,
  marketId: Hex,
): TelaranaMarket | null {
  const list = TELARANA_MARKETS[chainId];
  if (!list) return null;
  return list.find((m) => m.id.toLowerCase() === marketId.toLowerCase()) ?? null;
}

export function listTelaranaMarkets(): Array<TelaranaMarket & { chainId: TelaranaHubChainId; hubName: TelaranaHubName }> {
  return (Object.entries(TELARANA_DEPLOYMENTS) as Array<[string, TelaranaDeployment]>).flatMap(
    ([chainIdStr, deployment]) => {
      const chainId = Number(chainIdStr) as TelaranaHubChainId;
      return deployment.markets.map((m) => ({ ...m, chainId, hubName: deployment.hubName }));
    },
  );
}

export const TELARANA_RPC_URLS: Record<TelaranaHubChainId, string> = {
  43113: "https://avalanche-fuji.gateway.tenderly.co",
  5042002: "https://rpc.drpc.testnet.arc.network",
};

export function getTelaranaRpcUrl(chainId: TelaranaHubChainId): string {
  const envName = chainId === 43113 ? "TELARANA_FUJI_RPC_URL" : "TELARANA_ARC_RPC_URL";
  return process.env[envName] ?? TELARANA_RPC_URLS[chainId];
}
