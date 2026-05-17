import { createConfig } from "ponder";
import { http } from "viem";

import {
  CONTRACTS,
  DEFAULT_RPC_URLS,
  FxHubMessageReceiverAbi,
  FxOrderSettlementAbi,
  FxOracleAbi,
  FxPerpClearinghouseAbi,
  TelaranaGatewayHubHookAbi,
  buFxTelaranaRequestRouterAbi,
  buFxVenueRequestRouterAbi,
  fxSpotExecutorAbi,
} from "@bufi/contracts";

const databaseUrl = process.env.DATABASE_PRIVATE_URL ?? process.env.DATABASE_URL;
const database = databaseUrl
  ? { kind: "postgres" as const, connectionString: databaseUrl }
  : {
      kind: "pglite" as const,
      directory: process.env.PONDER_PGLITE_DIR ?? ".ponder/pglite",
    };

const chains = {
  arcTestnet: {
    id: 5042002,
    rpc: http(process.env.PONDER_RPC_URL_ARC_TESTNET ?? DEFAULT_RPC_URLS[5042002]),
  },
  avalancheFuji: {
    id: 43113,
    rpc: http(process.env.PONDER_RPC_URL_AVAX_FUJI ?? DEFAULT_RPC_URLS[43113]),
  },
} as const;

const fuji = CONTRACTS[43113];
const arc = CONTRACTS[5042002];
const perpsStartBlockArc = Number(process.env.PONDER_PERPS_START_BLOCK_ARC ?? 0);
const fxOrderSettlementArc =
  process.env.PONDER_PERPS_ORDER_SETTLEMENT_ADDRESS_ARC ??
  process.env.PONDER_PERPS_ADDRESS_ARC ??
  arc.perps.orderSettlement!;
const fxPerpClearinghouseArc =
  process.env.PONDER_PERPS_CLEARINGHOUSE_ADDRESS_ARC ?? arc.perps.clearinghouse!;

export default createConfig({
  database,
  chains,
  contracts: {
    BuFxVenueRequestRouterFuji: {
      chain: "avalancheFuji",
      abi: buFxVenueRequestRouterAbi,
      address: fuji.bufx.venueRequestRouter!,
      startBlock: Number(process.env.PONDER_BUFX_START_BLOCK_FUJI ?? 0),
    },
    BuFxTelaranaRequestRouterFuji: {
      chain: "avalancheFuji",
      abi: buFxTelaranaRequestRouterAbi,
      address: fuji.bufx.telaranaRequestRouter!,
      startBlock: Number(process.env.PONDER_BUFX_START_BLOCK_FUJI ?? 0),
    },
    BuFxVenueRequestRouterArc: {
      chain: "arcTestnet",
      abi: buFxVenueRequestRouterAbi,
      address: arc.bufx.venueRequestRouter!,
      startBlock: Number(process.env.PONDER_BUFX_START_BLOCK_ARC ?? 0),
    },
    BuFxTelaranaRequestRouterArc: {
      chain: "arcTestnet",
      abi: buFxTelaranaRequestRouterAbi,
      address: arc.bufx.telaranaRequestRouter!,
      startBlock: Number(process.env.PONDER_BUFX_START_BLOCK_ARC ?? 0),
    },
    TelaranaGatewayHubHookArc: {
      chain: "arcTestnet",
      abi: TelaranaGatewayHubHookAbi,
      address: arc.telarana.telaranaGatewayHubHook!,
      startBlock: Number(process.env.PONDER_TGH_START_BLOCK_ARC ?? 0),
    },
    FxSpotExecutorArc: {
      chain: "arcTestnet",
      abi: fxSpotExecutorAbi,
      address: arc.telarana.fxSpotExecutor!,
      startBlock: Number(process.env.PONDER_SPOT_EXECUTOR_START_BLOCK_ARC ?? 0),
    },
    FxOracleArc: {
      chain: "arcTestnet",
      abi: FxOracleAbi,
      address: arc.telarana.fxOracle!,
      startBlock: Number(process.env.PONDER_ORACLE_START_BLOCK_ARC ?? 0),
    },
    FxHubMessageReceiverFuji: {
      chain: "avalancheFuji",
      abi: FxHubMessageReceiverAbi,
      address: fuji.telarana.fxHubMessageReceiver!,
      startBlock: Number(process.env.PONDER_TELARANA_START_BLOCK_FUJI ?? 0),
    },
    FxOrderSettlementArc: {
      chain: "arcTestnet",
      abi: FxOrderSettlementAbi,
      address: fxOrderSettlementArc as `0x${string}`,
      startBlock: perpsStartBlockArc,
    },
    FxPerpClearinghouseArc: {
      chain: "arcTestnet",
      abi: FxPerpClearinghouseAbi,
      address: fxPerpClearinghouseArc as `0x${string}`,
      startBlock: perpsStartBlockArc,
    },
    ...(process.env.PONDER_BENTO_ADDRESS_FUJI && {
      BentoRoomFactoryFuji: {
        chain: "avalancheFuji",
        abi: [] as const,
        address: process.env.PONDER_BENTO_ADDRESS_FUJI as `0x${string}`,
        startBlock: Number(process.env.PONDER_BENTO_START_BLOCK_FUJI ?? 0),
      },
    }),
  },
});
