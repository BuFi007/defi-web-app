/**
 * @bufi/sdk — public TypeScript SDK for the BUFI perps + FX protocol.
 *
 * Quickstart:
 *
 * ```ts
 * import { createBufiClient, openPerp } from "@bufi/sdk";
 * import { ARC_PERP_MARKETS } from "@bufi/sdk/contracts";
 * import { createWalletClient, http } from "viem";
 * import { privateKeyToAccount } from "viem/accounts";
 * import { arcTestnet } from "@bufi/sdk/chains";
 *
 * const bufi = createBufiClient({
 *   apiUrl: "https://api.bu.finance",
 *   chainId: 5042002,
 * });
 *
 * const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
 * const walletClient = createWalletClient({
 *   account,
 *   chain: arcTestnet,
 *   transport: http(),
 * });
 *
 * const { intentId, status } = await openPerp(bufi, {
 *   marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
 *   side: "long",
 *   sizeUsdc: "10",
 *   leverage: 5,
 *   walletClient,
 * });
 * ```
 *
 * For tree-shakeable usage, import from the sub-paths instead:
 * `@bufi/sdk/perps/open`, `@bufi/sdk/queries/markets`, etc.
 */

// Core client.
export {
  BUFI_DEFAULT_API_URL,
  createBufiClient,
  perpsRest,
} from "./client";
export type {
  BufiClient,
  BufiClientConfig,
  BufiRequest,
  BufiRequestOptions,
  PerpsRestApi,
} from "./client";

// Chains.
export {
  CHAIN_IDS,
  DEFAULT_RPC_URLS,
  SUPPORTED_CHAIN_IDS,
  arcTestnet,
  avalancheFuji,
  getRpcUrl,
  getViemChain,
} from "./chains";
export type { ChainId } from "./chains";

// Contracts.
export {
  ARC_PERP_MARKETS,
  BUFX_PROTOCOL_PERP_MARKETS,
  CIRCLE_GATEWAY,
  CONTRACTS,
  FxFundingEngineAbi,
  FxHealthCheckerAbi,
  FxLiquidationEngineAbi,
  FxMarginAccountAbi,
  FxMarketRegistryAbi,
  FxOracleAbi,
  FxOrderSettlementAbi,
  FxPerpClearinghouseAbi,
  FxPerpMarketAbi,
  PYTH_FEED_IDS,
  SPOT_FX_ROUTES,
  getContracts,
  getPerpsContracts,
  loadContracts,
} from "./contracts";
export type { ChainContracts, PerpsContracts } from "./contracts";

// Errors.
export {
  BufiApiError,
  OracleStaleError,
  SignatureError,
  UnknownMarketError,
  UnsupportedChainError,
} from "./errors";

// Perps flows.
export * from "./perps";

// Read queries.
export * from "./queries";
