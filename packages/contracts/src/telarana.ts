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

export type TelaranaContractName =
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

export type TelaranaHubChainId = 43113 | 5042002;
export type TelaranaHubName = "fuji" | "arc";

export interface TelaranaMarket {
  /** Morpho-Blue market id (bytes32) computed from MarketParams. */
  id: Hex;
  /** Canonical key in deployments/*.marketIds (e.g. M1_EURC_USDC). */
  key: "M1_EURC_USDC" | "M2_USDC_EURC";
  loanSymbol: "USDC" | "EURC";
  collateralSymbol: "USDC" | "EURC";
  loanToken: Address;
  collateralToken: Address;
  /** Per-market Morpho oracle adapter that wraps the global FxOracle. */
  morphoOracleAdapter: Address;
}

interface TelaranaDeployment {
  chainId: TelaranaHubChainId;
  hubName: TelaranaHubName;
  hubLabel: string;
  contracts: Record<TelaranaContractName, Address>;
  marketIds: Record<TelaranaMarket["key"], Hex>;
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

function buildDeployment(
  raw: typeof telaranaArcDeployment | typeof telaranaFujiDeployment,
  hubName: TelaranaHubName,
  hubLabel: string,
): TelaranaDeployment {
  const contracts = raw.contracts as Record<string, string>;
  const marketIds = raw.marketIds as Record<string, string>;
  const external = (raw.external ?? {}) as Record<string, unknown>;
  const loanUSDC = asAddress(external.USDC);
  // Fuji has no native Circle EURC deployment — fall back to the MockEURC
  // shipped under contracts so the manifest loader doesn't crash at boot.
  const loanEURC = asAddress(external.EURC ?? contracts.MockEURC);
  return {
    chainId: raw.chainId as TelaranaHubChainId,
    hubName,
    hubLabel,
    contracts: Object.fromEntries(
      Object.entries(contracts).map(([k, v]) => [k, asAddress(v)]),
    ) as Record<TelaranaContractName, Address>,
    marketIds: {
      M1_EURC_USDC: asHex(marketIds.M1_EURC_USDC ?? ""),
      M2_USDC_EURC: asHex(marketIds.M2_USDC_EURC ?? ""),
    },
    // Morpho M1 is EURC borrowed against USDC collateral; M2 is the inverse.
    // We pin loan/collateral so the SDK doesn't have to re-read paramsOf().
    markets: [
      {
        id: asHex(marketIds.M1_EURC_USDC ?? ""),
        key: "M1_EURC_USDC",
        loanSymbol: "EURC",
        collateralSymbol: "USDC",
        loanToken: loanEURC,
        collateralToken: loanUSDC,
        morphoOracleAdapter: asAddress(contracts.MorphoOracleAdapterM1),
      },
      {
        id: asHex(marketIds.M2_USDC_EURC ?? ""),
        key: "M2_USDC_EURC",
        loanSymbol: "USDC",
        collateralSymbol: "EURC",
        loanToken: loanUSDC,
        collateralToken: loanEURC,
        morphoOracleAdapter: asAddress(contracts.MorphoOracleAdapterM2),
      },
    ],
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
  43113: "https://api.avax-test.network/ext/bc/C/rpc",
  5042002: "https://rpc.testnet.arc.network",
};

export function getTelaranaRpcUrl(chainId: TelaranaHubChainId): string {
  const envName = chainId === 43113 ? "TELARANA_FUJI_RPC_URL" : "TELARANA_ARC_RPC_URL";
  return process.env[envName] ?? TELARANA_RPC_URLS[chainId];
}
