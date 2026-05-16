import { createConfig } from "ponder";
import { http } from "viem";

/**
 * BUFI Ponder indexer. Pattern lifted from sendero's @sendero/indexer:
 * pglite for local dev, postgres for prod (DATABASE_URL takes priority).
 *
 * Contract addresses and ABIs are intentionally placeholders — they get
 * filled in as each domain ships its Solidity worktree. Each contract
 * registration is gated on its env var being set, so the indexer boots
 * cleanly even with partial deployments.
 */

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
    rpc: http(
      process.env.PONDER_RPC_URL_ARC_TESTNET ?? "https://rpc.testnet.arc.network",
    ),
  },
  avalancheFuji: {
    id: 43113,
    rpc: http(
      process.env.PONDER_RPC_URL_AVAX_FUJI ?? "https://api.avax-test.network/ext/bc/C/rpc",
    ),
  },
} as const;

export default createConfig({
  database,
  chains,
  contracts: {
    // Each registration is conditional — set the address env var on the
    // chain you want the indexer to watch.
    ...(process.env.PONDER_PERPS_ADDRESS_ARC && {
      Perps: {
        chain: "arcTestnet",
        abi: [] as const, // TODO: drop ABI in ./abis/Perps.abi.ts and import
        address: process.env.PONDER_PERPS_ADDRESS_ARC as `0x${string}`,
        startBlock: Number(process.env.PONDER_PERPS_START_BLOCK_ARC ?? 0),
      },
    }),
    ...(process.env.PONDER_BENTO_ADDRESS_FUJI && {
      Bento: {
        chain: "avalancheFuji",
        abi: [] as const,
        address: process.env.PONDER_BENTO_ADDRESS_FUJI as `0x${string}`,
        startBlock: Number(process.env.PONDER_BENTO_START_BLOCK_FUJI ?? 0),
      },
    }),
    ...(process.env.PONDER_TELARANA_ADDRESS_FUJI && {
      Telarana: {
        chain: "avalancheFuji",
        abi: [] as const,
        address: process.env.PONDER_TELARANA_ADDRESS_FUJI as `0x${string}`,
        startBlock: Number(process.env.PONDER_TELARANA_START_BLOCK_FUJI ?? 0),
      },
    }),
  } as Record<string, never>,
});
