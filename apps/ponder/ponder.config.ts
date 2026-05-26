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
import {
  BENTO_ARC_TESTNET_DEPLOYMENT,
  BENTO_AVALANCHE_FUJI_DEPLOYMENT,
  FxBentoCommitmentManagerAbi,
  FxBentoRoomEscrowAbi,
  FxBentoRoomFactoryAbi,
  FxBentoRoundManagerAbi,
  FxBentoSettlementManagerAbi,
} from "@bufi/contracts/bento";

const databaseUrl = process.env.DATABASE_PRIVATE_URL ?? process.env.DATABASE_URL;
const database = databaseUrl
  ? { kind: "postgres" as const, connectionString: databaseUrl }
  : {
      kind: "pglite" as const,
      directory: process.env.PONDER_PGLITE_DIR ?? ".ponder/pglite",
    };

// Keep backend indexers on an RPC that can serve old Fuji blocks and large
// getLogs ranges. The shared `DEFAULT_RPC_URLS[43113]` fallback is optimized
// for browser CORS reads, PublicNode returns null for some old blocks, and the
// official Avalanche endpoint rate-limits long Ponder backfills.
const DEFAULT_PONDER_FUJI_RPC_URL = "https://avalanche-fuji.gateway.tenderly.co";

const chains = {
  arcTestnet: {
    id: 5042002,
    rpc: http(process.env.PONDER_RPC_URL_ARC_TESTNET ?? DEFAULT_RPC_URLS[5042002]),
  },
  avalancheFuji: {
    id: 43113,
    rpc: http(process.env.PONDER_RPC_URL_AVAX_FUJI ?? DEFAULT_PONDER_FUJI_RPC_URL),
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
    // ─────────────────────────── FX Bento (Arc) ──────────────────────────
    // Subscribed by default — Arc Testnet is the live Bento stack per
    // packages/contracts/deployments/bento-arc-testnet.json. Each contract
    // can be address-overridden via PONDER_BENTO_*_ADDRESS_ARC; the start
    // block can be tuned via PONDER_BENTO_START_BLOCK_ARC.
    BentoRoomFactoryArc: {
      chain: "arcTestnet",
      abi: FxBentoRoomFactoryAbi,
      address: (process.env.PONDER_BENTO_ROOM_FACTORY_ADDRESS_ARC ??
        process.env.PONDER_BENTO_ADDRESS_ARC ??
        BENTO_ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoomFactory!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_ARC ?? BENTO_ARC_TESTNET_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoRoomEscrowArc: {
      chain: "arcTestnet",
      abi: FxBentoRoomEscrowAbi,
      address: (process.env.PONDER_BENTO_ROOM_ESCROW_ADDRESS_ARC ??
        BENTO_ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoomEscrow!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_ARC ?? BENTO_ARC_TESTNET_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoCommitmentManagerArc: {
      chain: "arcTestnet",
      abi: FxBentoCommitmentManagerAbi,
      address: (process.env.PONDER_BENTO_COMMITMENT_MANAGER_ADDRESS_ARC ??
        BENTO_ARC_TESTNET_DEPLOYMENT.addresses.FXBentoCommitmentManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_ARC ?? BENTO_ARC_TESTNET_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoRoundManagerArc: {
      chain: "arcTestnet",
      abi: FxBentoRoundManagerAbi,
      address: (process.env.PONDER_BENTO_ROUND_MANAGER_ADDRESS_ARC ??
        BENTO_ARC_TESTNET_DEPLOYMENT.addresses.FXBentoRoundManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_ARC ?? BENTO_ARC_TESTNET_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoSettlementManagerArc: {
      chain: "arcTestnet",
      abi: FxBentoSettlementManagerAbi,
      address: (process.env.PONDER_BENTO_SETTLEMENT_MANAGER_ADDRESS_ARC ??
        BENTO_ARC_TESTNET_DEPLOYMENT.addresses.FXBentoSettlementManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_ARC ?? BENTO_ARC_TESTNET_DEPLOYMENT.indexerStartBlock,
      ),
    },
    // ────────────────────────── FX Bento (Fuji) ──────────────────────────
    // Fuji has a parallel Bento deployment per bento-avalanche-fuji.json.
    // Subscribed by default; addresses can be overridden via
    // PONDER_BENTO_*_ADDRESS_FUJI envs and the start block via
    // PONDER_BENTO_START_BLOCK_FUJI. The legacy PONDER_BENTO_ADDRESS_FUJI
    // is honored as a back-compat alias for the room factory address.
    BentoRoomFactoryFuji: {
      chain: "avalancheFuji",
      abi: FxBentoRoomFactoryAbi,
      address: (process.env.PONDER_BENTO_ROOM_FACTORY_ADDRESS_FUJI ??
        process.env.PONDER_BENTO_ADDRESS_FUJI ??
        BENTO_AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoRoomFactory!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_FUJI ??
          BENTO_AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoRoomEscrowFuji: {
      chain: "avalancheFuji",
      abi: FxBentoRoomEscrowAbi,
      address: (process.env.PONDER_BENTO_ROOM_ESCROW_ADDRESS_FUJI ??
        BENTO_AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoRoomEscrow!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_FUJI ??
          BENTO_AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoCommitmentManagerFuji: {
      chain: "avalancheFuji",
      abi: FxBentoCommitmentManagerAbi,
      address: (process.env.PONDER_BENTO_COMMITMENT_MANAGER_ADDRESS_FUJI ??
        BENTO_AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoCommitmentManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_FUJI ??
          BENTO_AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoRoundManagerFuji: {
      chain: "avalancheFuji",
      abi: FxBentoRoundManagerAbi,
      address: (process.env.PONDER_BENTO_ROUND_MANAGER_ADDRESS_FUJI ??
        BENTO_AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoRoundManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_FUJI ??
          BENTO_AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock,
      ),
    },
    BentoSettlementManagerFuji: {
      chain: "avalancheFuji",
      abi: FxBentoSettlementManagerAbi,
      address: (process.env.PONDER_BENTO_SETTLEMENT_MANAGER_ADDRESS_FUJI ??
        BENTO_AVALANCHE_FUJI_DEPLOYMENT.addresses.FXBentoSettlementManager!) as `0x${string}`,
      startBlock: Number(
        process.env.PONDER_BENTO_START_BLOCK_FUJI ??
          BENTO_AVALANCHE_FUJI_DEPLOYMENT.indexerStartBlock,
      ),
    },
  },
});
