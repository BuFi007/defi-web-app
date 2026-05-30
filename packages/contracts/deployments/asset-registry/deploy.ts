/**
 * AssetRegistry deploy driver.
 *
 * Reads `testnet.json` or `mainnet.json` from this directory and seeds the
 * on-chain AssetRegistry on each declared hub chain. Spokes are recorded
 * in the config but do not host an AssetRegistry instance — they only
 * forward deposits via CCTP / JPYC routing.
 *
 * SUPPORTED CHAIN MATRIX (intentional — do not extend without spec change):
 *
 *   Testnet:
 *     - Arc Testnet     (5042002)  HUB
 *     - Avalanche Fuji  (43113)    HUB
 *     - Sepolia         (11155111) SPOKE
 *     - Polygon Amoy    (80002)    SPOKE
 *
 *   Mainnet:
 *     - Arc Mainnet     (TBD)      HUB
 *     - Avalanche       (43114)    HUB + EURC liquidity source
 *     - Ethereum        (1)        liquidity source
 *     - Polygon         (137)      JPYC liquidity source
 *
 * NOT SUPPORTED: Kaia / Kairos (1001, 8217). Configs intentionally omit
 * these entries. Do not re-add them without a product decision.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type ChainRole = "hub" | "spoke" | "liquidity-source";

interface ChainEntry {
  chainId: number | null;
  role: ChainRole;
  rpcUrl: string;
  cctpDomain: number | null;
  explorer: string;
  nativeGasToken: string;
  liquiditySources?: string[];
  chainIdNote?: string;
}

interface AssetEntry {
  symbol: string;
  decimals: number;
  addresses: Record<string, string>;
}

interface RegistryConfig {
  network: "testnet" | "mainnet";
  description: string;
  chains: Record<string, ChainEntry>;
  assets: Record<string, AssetEntry>;
}

/** Chain IDs that must never be deployed to, even if a config accidentally
 *  re-introduces them. */
const REFUSE_CHAIN_IDS = new Set<number>([
  1001, // Kaia Kairos testnet
  8217, // Kaia mainnet
]);

function loadConfig(network: "testnet" | "mainnet"): RegistryConfig {
  const path = join(__dirname, `${network}.json`);
  const raw = readFileSync(path, "utf8");
  const cfg = JSON.parse(raw) as RegistryConfig;

  // Defensive: refuse Kaia even if someone adds it back.
  for (const [name, chain] of Object.entries(cfg.chains)) {
    if (chain.chainId !== null && REFUSE_CHAIN_IDS.has(chain.chainId)) {
      throw new Error(
        `Refusing to deploy: chain "${name}" (chainId=${chain.chainId}) is on the Kaia refuse-list. ` +
          `Remove from ${network}.json before proceeding.`,
      );
    }
  }

  return cfg;
}

function pickDeployTargets(cfg: RegistryConfig): Array<[string, ChainEntry]> {
  // AssetRegistry only deploys to HUB chains. Spokes / liquidity-sources
  // are recorded but skipped.
  return Object.entries(cfg.chains).filter(([, c]) => c.role === "hub");
}

async function deployToChain(
  name: string,
  chain: ChainEntry,
  cfg: RegistryConfig,
): Promise<void> {
  if (chain.chainId === null) {
    console.warn(
      `[asset-registry] Skipping ${name}: chainId is TBD — populate config and re-run. ${
        chain.chainIdNote ?? ""
      }`,
    );
    return;
  }

  console.log(
    `[asset-registry] Deploying to ${name} (chainId=${chain.chainId}, rpc=${chain.rpcUrl})`,
  );

  // Each asset whose `addresses` map contains this chainId is registered.
  const chainKey = String(chain.chainId);
  for (const [symbol, asset] of Object.entries(cfg.assets)) {
    const addr = asset.addresses[chainKey];
    if (!addr) continue;
    console.log(
      `  - register ${symbol} (decimals=${asset.decimals}) -> ${addr}`,
    );
    // TODO: wire to actual on-chain call:
    //   await assetRegistry.registerAsset(symbol, addr, asset.decimals);
  }
}

async function main() {
  const network = (process.argv[2] ?? "testnet") as "testnet" | "mainnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`Unknown network "${network}". Use "testnet" or "mainnet".`);
  }

  const cfg = loadConfig(network);
  const targets = pickDeployTargets(cfg);

  console.log(
    `[asset-registry] Loaded ${network} config — ${
      Object.keys(cfg.chains).length
    } chains, ${targets.length} hub target(s).`,
  );

  for (const [name, chain] of targets) {
    await deployToChain(name, chain, cfg);
  }

  console.log("[asset-registry] Done.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadConfig, pickDeployTargets, REFUSE_CHAIN_IDS };
