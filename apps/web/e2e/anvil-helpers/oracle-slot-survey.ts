/**
 * Wave F5a — FxOracle storage-slot survey.
 *
 * Read-only probe against Arc Testnet. Walks each FxOracle state variable,
 * reads its declared storage slot via `eth_getStorageAt`, cross-checks the
 * decoded value against the contract's public view function, and emits a
 * canonical manifest (`oracle-slots.json`) consumed by later waves (F5b
 * `anvil_setStorageAt` cheats, F5c spec un-fixme).
 *
 * Storage layout is sourced from `forge inspect FxOracle storageLayout`
 * against the sibling repo's commit `e98db26` — the actual source the
 * Arc Testnet contract was deployed from. NOTE: a later branch
 * (`feat/privacy-hook-slice-3-crossccy`) refactors FxOracle onto
 * `AccessControl` and inserts `pythFeedInvertedOf` between the two
 * mappings, which would shift slots. The deployed bytecode at
 * `0x77b3A…` is the older Ownable variant — confirmed by selector
 * inspection (owner(), transferOwner(address)) and live storage
 * cross-check (`_roles` would put the maps at slots 5/6, but they're
 * at 4/5). Storage layout for the deployed contract:
 *
 *   slot 0  owner             address (20 bytes — Ownable, not AccessControl)
 *   slot 1  maxOracleAge      uint256
 *   slot 2  maxDeviationBps   uint256
 *   slot 3  maxConfidenceBps  uint256
 *   slot 4  pythFeedOf        mapping(address => bytes32)
 *   slot 5  redstoneFeedOf    mapping(address => bytes32)
 *
 * For mapping entries, the storage key is
 *   keccak256(abi.encode(tokenAddress, mappingSlotPosition))
 * per the standard Solidity storage layout.
 *
 * Hard-fail policy: ANY slot whose decoded value disagrees with its view
 * counterpart aborts the survey with a non-zero exit. Better to crash loud
 * than ship a manifest that points the cheat-code helpers at the wrong
 * 32 bytes.
 *
 * Run:
 *   bun run apps/web/e2e/anvil-helpers/oracle-slot-survey.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createPublicClient,
  http,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";

// ────────────────────────────────────────────────────────────────────────────
// Constants — frozen by the deploy on Arc Testnet
// ────────────────────────────────────────────────────────────────────────────

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;

const FX_ORACLE: Address = "0x77b3A3B420dB98B01085b8C46a753Ed9879e2865";

// Tokens we surface in mapping lookups. EURC is the perp underlying;
// USDC is the collateral / quote leg. Both addresses are the canonical
// Arc Testnet deployments — USDC is the 0x36 precompile.
const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const USDC: Address = "0x3600000000000000000000000000000000000000";

// Slot positions from `forge inspect FxOracle storageLayout`.
const SLOT_MAX_ORACLE_AGE = 1n;
const SLOT_MAX_DEVIATION_BPS = 2n;
const SLOT_MAX_CONFIDENCE_BPS = 3n;
const SLOT_PYTH_FEED_OF = 4n;
const SLOT_REDSTONE_FEED_OF = 5n;

// Minimal ABI — only the views we need to cross-check the storage reads.
const FX_ORACLE_ABI = [
  {
    type: "function",
    name: "PYTH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "maxOracleAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxConfidenceBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pythFeedOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "redstoneFeedOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

// ────────────────────────────────────────────────────────────────────────────
// viem client
// ────────────────────────────────────────────────────────────────────────────

const arcChain = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public: { http: [ARC_RPC_URL] },
  },
} as const;

const client = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function slotToHex32(slot: bigint): Hex {
  return `0x${slot.toString(16).padStart(64, "0")}` as Hex;
}

/**
 * Storage key for `mapping(address => T) m;` at base slot `mappingSlot`,
 * keyed by `token`. Standard Solidity layout:
 *   key = keccak256(abi.encode(token, mappingSlot))
 */
function mappingKey(token: Address, mappingSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [token, mappingSlot],
    ),
  );
}

async function readStorage(slot: Hex): Promise<Hex> {
  const value = await client.getStorageAt({ address: FX_ORACLE, slot });
  if (!value) {
    throw new Error(`[oracle-survey] eth_getStorageAt returned null for slot ${slot}`);
  }
  return value;
}

/** Decode the low 32 bytes of a storage slot as a uint256. */
function decodeUint(slotValue: Hex): bigint {
  return BigInt(slotValue);
}

/**
 * Normalize a hex string to canonical 32-byte 0x-prefixed lowercase form.
 * Both `eth_getStorageAt` and view-returned bytes32 should match after this.
 */
function normalize32(h: Hex): Hex {
  const stripped = h.toLowerCase().replace(/^0x/, "");
  return `0x${stripped.padStart(64, "0")}` as Hex;
}

interface SlotCheckResult {
  ok: boolean;
  detail: string;
}

function check(label: string, ok: boolean, detail: string): SlotCheckResult {
  const tag = ok ? "OK " : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`  [${tag}] ${label}: ${detail}`);
  return { ok, detail };
}

// ────────────────────────────────────────────────────────────────────────────
// Survey
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[oracle-survey] FxOracle = ${FX_ORACLE} on Arc Testnet (${ARC_CHAIN_ID})`);

  const chainId = await client.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(
      `[oracle-survey] expected chain ${ARC_CHAIN_ID}, RPC reported ${chainId}`,
    );
  }
  const blockNumber = await client.getBlockNumber();
  // eslint-disable-next-line no-console
  console.log(`[oracle-survey] block ${blockNumber}`);

  // Stop condition: PYTH must be non-zero.
  const pythAddress = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "PYTH",
  })) as Address;
  if (pythAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      "[oracle-survey] FxOracle.PYTH() returned address(0) — misconfiguration. Stopping.",
    );
  }
  // eslint-disable-next-line no-console
  console.log(`[oracle-survey] Pyth contract = ${pythAddress}`);

  const results: SlotCheckResult[] = [];

  // ── Scalar slots ────────────────────────────────────────────────────────

  // slot 1 — maxOracleAge
  const maxOracleAgeSlot = slotToHex32(SLOT_MAX_ORACLE_AGE);
  const maxOracleAgeRaw = await readStorage(maxOracleAgeSlot);
  const maxOracleAgeDecoded = decodeUint(maxOracleAgeRaw);
  const maxOracleAgeView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "maxOracleAge",
  })) as bigint;
  results.push(
    check(
      `slot ${maxOracleAgeSlot} maxOracleAge`,
      maxOracleAgeDecoded === maxOracleAgeView,
      `raw=${maxOracleAgeRaw} decoded=${maxOracleAgeDecoded} view=${maxOracleAgeView} ${
        maxOracleAgeDecoded === maxOracleAgeView ? "match" : "MISMATCH"
      }`,
    ),
  );

  // slot 2 — maxDeviationBps
  const maxDeviationBpsSlot = slotToHex32(SLOT_MAX_DEVIATION_BPS);
  const maxDeviationBpsRaw = await readStorage(maxDeviationBpsSlot);
  const maxDeviationBpsDecoded = decodeUint(maxDeviationBpsRaw);
  const maxDeviationBpsView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "maxDeviationBps",
  })) as bigint;
  results.push(
    check(
      `slot ${maxDeviationBpsSlot} maxDeviationBps`,
      maxDeviationBpsDecoded === maxDeviationBpsView,
      `raw=${maxDeviationBpsRaw} decoded=${maxDeviationBpsDecoded} view=${maxDeviationBpsView} ${
        maxDeviationBpsDecoded === maxDeviationBpsView ? "match" : "MISMATCH"
      }`,
    ),
  );

  // slot 3 — maxConfidenceBps
  const maxConfidenceBpsSlot = slotToHex32(SLOT_MAX_CONFIDENCE_BPS);
  const maxConfidenceBpsRaw = await readStorage(maxConfidenceBpsSlot);
  const maxConfidenceBpsDecoded = decodeUint(maxConfidenceBpsRaw);
  const maxConfidenceBpsView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "maxConfidenceBps",
  })) as bigint;
  results.push(
    check(
      `slot ${maxConfidenceBpsSlot} maxConfidenceBps`,
      maxConfidenceBpsDecoded === maxConfidenceBpsView,
      `raw=${maxConfidenceBpsRaw} decoded=${maxConfidenceBpsDecoded} view=${maxConfidenceBpsView} ${
        maxConfidenceBpsDecoded === maxConfidenceBpsView ? "match" : "MISMATCH"
      }`,
    ),
  );

  // ── Mapping slots: pythFeedOf ───────────────────────────────────────────

  const pythFeedOfBase = slotToHex32(SLOT_PYTH_FEED_OF);

  const pythFeedEurcSlot = mappingKey(EURC, SLOT_PYTH_FEED_OF);
  const pythFeedEurcRaw = await readStorage(pythFeedEurcSlot);
  const pythFeedEurcView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "pythFeedOf",
    args: [EURC],
  })) as Hex;
  results.push(
    check(
      `pythFeedOf[EURC] @ ${pythFeedEurcSlot}`,
      normalize32(pythFeedEurcRaw) === normalize32(pythFeedEurcView),
      `raw=${pythFeedEurcRaw} view=${pythFeedEurcView} ${
        normalize32(pythFeedEurcRaw) === normalize32(pythFeedEurcView) ? "match" : "MISMATCH"
      }`,
    ),
  );

  const pythFeedUsdcSlot = mappingKey(USDC, SLOT_PYTH_FEED_OF);
  const pythFeedUsdcRaw = await readStorage(pythFeedUsdcSlot);
  const pythFeedUsdcView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "pythFeedOf",
    args: [USDC],
  })) as Hex;
  results.push(
    check(
      `pythFeedOf[USDC] @ ${pythFeedUsdcSlot}`,
      normalize32(pythFeedUsdcRaw) === normalize32(pythFeedUsdcView),
      `raw=${pythFeedUsdcRaw} view=${pythFeedUsdcView} ${
        normalize32(pythFeedUsdcRaw) === normalize32(pythFeedUsdcView) ? "match" : "MISMATCH"
      }`,
    ),
  );

  // ── Mapping slots: redstoneFeedOf ───────────────────────────────────────

  const redstoneFeedOfBase = slotToHex32(SLOT_REDSTONE_FEED_OF);

  const redstoneFeedEurcSlot = mappingKey(EURC, SLOT_REDSTONE_FEED_OF);
  const redstoneFeedEurcRaw = await readStorage(redstoneFeedEurcSlot);
  const redstoneFeedEurcView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "redstoneFeedOf",
    args: [EURC],
  })) as Hex;
  results.push(
    check(
      `redstoneFeedOf[EURC] @ ${redstoneFeedEurcSlot}`,
      normalize32(redstoneFeedEurcRaw) === normalize32(redstoneFeedEurcView),
      `raw=${redstoneFeedEurcRaw} view=${redstoneFeedEurcView} ${
        normalize32(redstoneFeedEurcRaw) === normalize32(redstoneFeedEurcView) ? "match" : "MISMATCH"
      }`,
    ),
  );

  const redstoneFeedUsdcSlot = mappingKey(USDC, SLOT_REDSTONE_FEED_OF);
  const redstoneFeedUsdcRaw = await readStorage(redstoneFeedUsdcSlot);
  const redstoneFeedUsdcView = (await client.readContract({
    address: FX_ORACLE,
    abi: FX_ORACLE_ABI,
    functionName: "redstoneFeedOf",
    args: [USDC],
  })) as Hex;
  results.push(
    check(
      `redstoneFeedOf[USDC] @ ${redstoneFeedUsdcSlot}`,
      normalize32(redstoneFeedUsdcRaw) === normalize32(redstoneFeedUsdcView),
      `raw=${redstoneFeedUsdcRaw} view=${redstoneFeedUsdcView} ${
        normalize32(redstoneFeedUsdcRaw) === normalize32(redstoneFeedUsdcView) ? "match" : "MISMATCH"
      }`,
    ),
  );

  // ── Hard-fail on any mismatch ───────────────────────────────────────────

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[oracle-survey] ${failed.length}/${results.length} slot validations FAILED — refusing to write manifest.`,
    );
    for (const f of failed) {
      // eslint-disable-next-line no-console
      console.error(`  ${f.detail}`);
    }
    process.exit(1);
  }

  // ── Emit manifest ───────────────────────────────────────────────────────

  const manifest = {
    FxOracle: FX_ORACLE,
    PythContract: pythAddress,
    chainId: ARC_CHAIN_ID,
    verifiedAt: new Date().toISOString(),
    verifiedAtBlock: blockNumber.toString(),
    slots: {
      maxOracleAge: maxOracleAgeRaw,
      maxDeviationBps: maxDeviationBpsRaw,
      maxConfidenceBps: maxConfidenceBpsRaw,
      pythFeedOf: {
        _mappingSlot: pythFeedOfBase,
        EURC: pythFeedEurcSlot,
        USDC: pythFeedUsdcSlot,
      },
      redstoneFeedOf: {
        _mappingSlot: redstoneFeedOfBase,
        EURC: redstoneFeedEurcSlot,
        USDC: redstoneFeedUsdcSlot,
      },
    },
    values: {
      maxOracleAge: maxOracleAgeDecoded.toString(),
      maxDeviationBps: maxDeviationBpsDecoded.toString(),
      maxConfidenceBps: maxConfidenceBpsDecoded.toString(),
      pythFeedOf: {
        EURC: normalize32(pythFeedEurcRaw),
        USDC: normalize32(pythFeedUsdcRaw),
      },
      redstoneFeedOf: {
        EURC: normalize32(redstoneFeedEurcRaw),
        USDC: normalize32(redstoneFeedUsdcRaw),
      },
    },
  } as const;

  // Stable key order + trailing newline for diff hygiene.
  const outPath = resolve(
    import.meta.dir ?? new URL(".", import.meta.url).pathname,
    "oracle-slots.json",
  );
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(
    `[oracle-survey] wrote ${outPath} — ${results.length}/${results.length} slot validations passed.`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[oracle-survey] fatal:", err);
  process.exit(1);
});
