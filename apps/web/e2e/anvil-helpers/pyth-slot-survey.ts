/**
 * Wave G1 (F5d) — PythUpgradable storage-slot survey.
 *
 * Read-only probe against Arc Testnet's deployed Pyth proxy at
 * `0x2880aB155794e7179c9eE2e38200202908C17B43`. Finds the mapping base
 * slot for `_state.latestPriceInfo` (the live price storage — the V1/V2
 * deprecated maps are NOT what `getPriceUnsafe` reads) and validates by
 * cross-checking the decoded slot bytes against `getPriceUnsafe(feedId)`
 * view output for the two feeds we care about (EURC, USDC).
 *
 * ─── Why brute-force, not "forge inspect" ────────────────────────────────
 *
 * Pyth's `PythUpgradable` is:
 *   `Initializable, OwnableUpgradeable, UUPSUpgradeable, Pyth, PythGovernance`
 * with `Pyth -> PythGetters/PythSetters/AbstractPyth/PythAccumulator`,
 * `PythGovernance -> PythGetters/PythSetters/PythGovernanceInstructions`,
 * and `PythGetters/PythSetters/PythGovernanceInstructions -> PythState`.
 *
 * `PythState` declares the single state var `PythStorage.State _state`.
 * Everything we care about lives inside that struct, but the diamond of
 * upgradeable-OZ contracts above shifts the base offset of `_state` in a
 * way that depends on which OZ version was compiled in — the deployed
 * implementation could be from any of several Pyth releases.
 *
 * Rather than commit to an OZ version + tag, we probe: walk candidate
 * mapping slots 0..MAX_PROBE, compute the standard mapping key for a
 * known feedId, read the storage at that key, decode the packed `PriceInfo`
 * slot 1, and check it matches `getPriceUnsafe(feedId)`. The first slot
 * that matches BOTH known feeds wins.
 *
 * ─── PriceInfo packing (from pyth-network/pyth-crosschain
 *     target_chains/ethereum/contracts/contracts/pyth/PythInternalStructs.sol) ─
 *
 *   struct PriceInfo {
 *     // slot 1 (28 bytes used, packs into one EVM word, low-byte first)
 *     uint64 publishTime;  // offset  0, 8 bytes
 *     int32  expo;         // offset  8, 4 bytes
 *     int64  price;        // offset 12, 8 bytes
 *     uint64 conf;         // offset 20, 8 bytes
 *     // slot 2
 *     int64  emaPrice;     // offset  0, 8 bytes
 *     uint64 emaConf;      // offset  8, 8 bytes
 *   }
 *
 * The mapping value occupies two contiguous slots. `latestPriceInfo[id]`
 * resolves to baseSlot = keccak256(abi.encode(id, mappingSlot)); slot 2
 * is baseSlot + 1.
 *
 * IPyth.Price.publishTime is `uint` (uint256) in the SDK interface — the
 * `queryPriceFeed` body casts the on-chain uint64 to uint. Don't be
 * confused by docs that say "uint256 publishTime in storage" — in
 * storage it's the uint64 from PriceInfo.
 *
 * ─── Hard-fail policy ────────────────────────────────────────────────────
 *
 * - If we can't find a mapping slot whose decoded bytes match the view
 *   for BOTH EURC and USDC, abort non-zero. Don't write a manifest that
 *   would point `setPythPrice` at the wrong 32 bytes.
 * - If the decoded slot 2 (emaPrice/emaConf) doesn't match the EMA view
 *   either, abort — we'd be missing half the struct.
 *
 * Run:
 *   bun run apps/web/e2e/anvil-helpers/pyth-slot-survey.ts
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

const PYTH_CONTRACT: Address = "0x2880aB155794e7179c9eE2e38200202908C17B43";

// Feed ids — sourced from F5a's oracle-slots.json values.pythFeedOf. Kept
// hard-coded here (rather than imported) because the survey must remain
// runnable even if oracle-slots.json hasn't been re-generated yet.
const FEED_IDS = {
  EURC: "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c" as Hex,
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" as Hex,
} as const;

/**
 * Highest candidate mapping slot to probe. The deployed bytecode is some
 * pyth-crosschain release (commit unknown — see ABOUT BYTECODE below),
 * and slot offsets for `_state.latestPriceInfo` historically land below
 * 20. 64 leaves comfortable headroom without scanning forever.
 *
 * ABOUT BYTECODE: we don't pin a Pyth git commit here. The deployed proxy
 * is a UUPS proxy; the implementation can be upgraded by Pyth at any
 * time. The survey is the single source of truth — re-running it after
 * a Pyth upgrade re-emits the manifest. The cheat helper consumes the
 * manifest, not a hard-coded slot.
 */
const MAX_PROBE_SLOT = 256;

// ────────────────────────────────────────────────────────────────────────────
// ABI — just the views we need to cross-check storage reads
// ────────────────────────────────────────────────────────────────────────────

// PythStructs.Price uses `uint publishTime` (uint256). On Arc Testnet the
// proxy implementation seems to predate a getter rename; we use the
// stable selector `getPriceUnsafe(bytes32) returns (Price)` — verified
// via raw `eth_call` to selector 0x96834ad3 returning four 32-byte words.
const PYTH_ABI = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "id" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "int64", name: "price" },
          { type: "uint64", name: "conf" },
          { type: "int32", name: "expo" },
          { type: "uint256", name: "publishTime" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getEmaPriceUnsafe",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "id" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "int64", name: "price" },
          { type: "uint64", name: "conf" },
          { type: "int32", name: "expo" },
          { type: "uint256", name: "publishTime" },
        ],
      },
    ],
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
// Slot bytes helpers
// ────────────────────────────────────────────────────────────────────────────

function slotToHex32(slot: bigint): Hex {
  return `0x${slot.toString(16).padStart(64, "0")}` as Hex;
}

function mappingKey(id: Hex, mappingSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [id, mappingSlot],
    ),
  );
}

async function readStorage(slot: Hex): Promise<Hex> {
  const value = await client.getStorageAt({ address: PYTH_CONTRACT, slot });
  if (!value) {
    throw new Error(
      `[pyth-survey] eth_getStorageAt returned null for slot ${slot}`,
    );
  }
  return value;
}

/**
 * Strip 0x, normalize to 64 hex chars (32 bytes), lowercase.
 * The byte at storage offset N is at hex chars (62-2N..64-2N) of the
 * canonical 32-byte hex string — i.e. byte 0 is the LAST two hex chars.
 */
function normalizeSlot(h: Hex): string {
  return h.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * Read N bytes of the slot starting at byte offset `byteOffset` (LSB-first,
 * Solidity packing convention). Returns the bytes as a BigInt (unsigned).
 */
function readBytesFromSlot(
  slotHex: Hex,
  byteOffset: number,
  byteLength: number,
): bigint {
  const norm = normalizeSlot(slotHex);
  // Hex char position from the right end: byteOffset * 2 chars from the
  // right is the start of the field. The field occupies byteLength*2 chars
  // ending at (64 - byteOffset*2).
  const charEnd = 64 - byteOffset * 2;
  const charStart = charEnd - byteLength * 2;
  if (charStart < 0) {
    throw new Error(
      `[pyth-survey] readBytesFromSlot out of range: offset=${byteOffset} length=${byteLength}`,
    );
  }
  const segment = norm.slice(charStart, charEnd);
  return BigInt(`0x${segment}`);
}

/**
 * Sign-extend an N-byte value (treated as two's complement) to a signed
 * bigint. Used for `int32 expo` (4 bytes) and `int64 price` / `int64
 * emaPrice` (8 bytes). Without this, negative expos look like huge
 * positive numbers and the cross-check fails.
 */
function signExtend(value: bigint, byteLength: number): bigint {
  const bitWidth = BigInt(byteLength * 8);
  const signBit = 1n << (bitWidth - 1n);
  if (value & signBit) {
    return value - (1n << bitWidth);
  }
  return value;
}

interface DecodedPriceInfoSlot1 {
  publishTime: bigint; // uint64
  expo: bigint; // int32 (signed)
  price: bigint; // int64 (signed)
  conf: bigint; // uint64
}

interface DecodedPriceInfoSlot2 {
  emaPrice: bigint; // int64 (signed)
  emaConf: bigint; // uint64
}

/**
 * Decode slot 1 of `PriceInfo`:
 *   uint64 publishTime @ byte 0..7
 *   int32  expo        @ byte 8..11
 *   int64  price       @ byte 12..19
 *   uint64 conf        @ byte 20..27
 */
function decodeSlot1(slotHex: Hex): DecodedPriceInfoSlot1 {
  return {
    publishTime: readBytesFromSlot(slotHex, 0, 8),
    expo: signExtend(readBytesFromSlot(slotHex, 8, 4), 4),
    price: signExtend(readBytesFromSlot(slotHex, 12, 8), 8),
    conf: readBytesFromSlot(slotHex, 20, 8),
  };
}

/**
 * Decode slot 2 of `PriceInfo`:
 *   int64  emaPrice @ byte 0..7
 *   uint64 emaConf  @ byte 8..15
 */
function decodeSlot2(slotHex: Hex): DecodedPriceInfoSlot2 {
  return {
    emaPrice: signExtend(readBytesFromSlot(slotHex, 0, 8), 8),
    emaConf: readBytesFromSlot(slotHex, 8, 8),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pyth view types
// ────────────────────────────────────────────────────────────────────────────

interface PythPriceView {
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: bigint;
}

async function getPriceUnsafe(id: Hex): Promise<PythPriceView> {
  const res = (await client.readContract({
    address: PYTH_CONTRACT,
    abi: PYTH_ABI,
    functionName: "getPriceUnsafe",
    args: [id],
  })) as { price: bigint; conf: bigint; expo: number; publishTime: bigint };
  return res;
}

async function getEmaPriceUnsafe(id: Hex): Promise<PythPriceView> {
  const res = (await client.readContract({
    address: PYTH_CONTRACT,
    abi: PYTH_ABI,
    functionName: "getEmaPriceUnsafe",
    args: [id],
  })) as { price: bigint; conf: bigint; expo: number; publishTime: bigint };
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// Slot 1 packing self-check (catches sign-extension / endianness bugs
// BEFORE we go probing on-chain). If this fails, the read/write helpers
// can't be trusted — abort the survey loud.
//
// We pack a known set of values, then decode, and assert round-trip.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pack `{ publishTime, expo, price, conf }` into a 32-byte hex string
 * (Solidity packing order, low-byte first).
 *
 *   bytes:  [publishTime(8)][expo(4)][price(8)][conf(4 high-zero padding)…]
 *
 * Actually: the slot is 32 bytes. Fields go LSB-first. So the canonical
 * 32-byte hex string (big-endian display) has:
 *   chars 64-16..64-0  ← publishTime (low 16 hex chars from right)
 *   chars 64-24..64-16 ← expo (next 8 hex chars to the left)
 *   chars 64-40..64-24 ← price (next 16 hex chars)
 *   chars 64-56..64-40 ← conf (next 16 hex chars)
 *   chars 0..64-56     ← unused (zero-padded)
 */
function packSlot1({
  publishTime,
  expo,
  price,
  conf,
}: {
  publishTime: bigint;
  expo: bigint;
  price: bigint;
  conf: bigint;
}): Hex {
  // Mask to byte widths. Two's complement for signed: AND with width mask
  // gives the correct LSB-aligned representation.
  const mask64 = (1n << 64n) - 1n;
  const mask32 = (1n << 32n) - 1n;

  const publishTimeBytes = publishTime & mask64;
  const expoBytes = expo & mask32;
  const priceBytes = price & mask64;
  const confBytes = conf & mask64;

  // Assemble as a 256-bit BigInt, then format as 32-byte hex.
  const composed =
    (confBytes << 160n) | (priceBytes << 96n) | (expoBytes << 64n) | publishTimeBytes;

  return `0x${composed.toString(16).padStart(64, "0")}` as Hex;
}

function selfCheckPacking() {
  // Use values that exercise sign extension + non-trivial bit patterns.
  const cases = [
    {
      publishTime: 0x6a0d2e7dn,
      expo: -8n,
      price: 99947316n,
      conf: 96400n,
    },
    {
      publishTime: 1779543165n,
      expo: -5n,
      price: -1234567890n, // negative price (unusual but possible for spreads)
      conf: 50n,
    },
    {
      publishTime: 0xffffffffffffffffn, // max uint64
      expo: 2147483647n, // max int32
      price: -9223372036854775808n, // min int64
      conf: 0xffffffffffffffffn, // max uint64
    },
  ];
  for (const [i, c] of cases.entries()) {
    const packed = packSlot1(c);
    const dec = decodeSlot1(packed);
    if (
      dec.publishTime !== c.publishTime ||
      dec.expo !== c.expo ||
      dec.price !== c.price ||
      dec.conf !== c.conf
    ) {
      throw new Error(
        `[pyth-survey] slot1 packing self-check FAILED case ${i}: ` +
          `expected=${JSON.stringify(c, replacer)} ` +
          `decoded=${JSON.stringify(dec, replacer)} ` +
          `packed=${packed}`,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[pyth-survey] slot1 packing self-check passed (${cases.length} cases)`);
}

// JSON replacer for BigInt — used only in error messages.
function replacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

// ────────────────────────────────────────────────────────────────────────────
// Survey loop
// ────────────────────────────────────────────────────────────────────────────

interface FeedProbeResult {
  label: "EURC" | "USDC";
  feedId: Hex;
  priceSlot: Hex;
  slot1Raw: Hex;
  slot2Raw: Hex;
  decodedSlot1: DecodedPriceInfoSlot1;
  decodedSlot2: DecodedPriceInfoSlot2;
  view: PythPriceView;
  emaView: PythPriceView;
}

function viewMatchesDecoded(
  view: PythPriceView,
  d: DecodedPriceInfoSlot1,
): boolean {
  return (
    d.publishTime === view.publishTime &&
    d.expo === BigInt(view.expo) &&
    d.price === view.price &&
    d.conf === view.conf
  );
}

async function probeMappingSlot(
  mappingSlot: bigint,
  feedId: Hex,
  view: PythPriceView,
): Promise<{ matched: boolean; key: Hex; slot1Raw: Hex; decoded: DecodedPriceInfoSlot1 }> {
  const key = mappingKey(feedId, mappingSlot);
  const slot1Raw = await readStorage(key);
  const decoded = decodeSlot1(slot1Raw);
  return { matched: viewMatchesDecoded(view, decoded), key, slot1Raw, decoded };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(
    `[pyth-survey] Pyth proxy = ${PYTH_CONTRACT} on Arc Testnet (${ARC_CHAIN_ID})`,
  );

  // Sanity: chain id.
  const chainId = await client.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(
      `[pyth-survey] expected chain ${ARC_CHAIN_ID}, RPC reported ${chainId}`,
    );
  }
  const blockNumber = await client.getBlockNumber();
  // eslint-disable-next-line no-console
  console.log(`[pyth-survey] block ${blockNumber}`);

  // Catch local bugs before they look like remote bugs.
  selfCheckPacking();

  // Read views first — these define what we're hunting for in storage.
  const eurcView = await getPriceUnsafe(FEED_IDS.EURC);
  const usdcView = await getPriceUnsafe(FEED_IDS.USDC);
  const eurcEma = await getEmaPriceUnsafe(FEED_IDS.EURC);
  const usdcEma = await getEmaPriceUnsafe(FEED_IDS.USDC);
  // eslint-disable-next-line no-console
  console.log(
    `[pyth-survey] EURC view price=${eurcView.price} conf=${eurcView.conf} expo=${eurcView.expo} publishTime=${eurcView.publishTime}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[pyth-survey] USDC view price=${usdcView.price} conf=${usdcView.conf} expo=${usdcView.expo} publishTime=${usdcView.publishTime}`,
  );

  // Probe candidate mapping slots. Walk EURC first; for any candidate
  // that matches, cross-check USDC. A slot that matches BOTH feeds is
  // the real mapping base — random keccak collisions for a single feed
  // are statistically impossible at this scan width.
  let found:
    | { mappingSlot: bigint; eurc: FeedProbeResult; usdc: FeedProbeResult }
    | null = null;

  for (let i = 0n; i <= BigInt(MAX_PROBE_SLOT); i++) {
    const eurcProbe = await probeMappingSlot(i, FEED_IDS.EURC, eurcView);
    if (!eurcProbe.matched) {
      continue;
    }

    // EURC matched at this slot — cross-check USDC at the same mapping slot.
    const usdcProbe = await probeMappingSlot(i, FEED_IDS.USDC, usdcView);
    if (!usdcProbe.matched) {
      // eslint-disable-next-line no-console
      console.log(
        `[pyth-survey] slot ${i}: EURC matched but USDC didn't — keeping search open`,
      );
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(`[pyth-survey] mapping base slot = ${i}`);

    // Read slot 2 for both feeds (baseSlot + 1) and decode EMA half.
    const eurcSlot2Key = `0x${(BigInt(eurcProbe.key) + 1n)
      .toString(16)
      .padStart(64, "0")}` as Hex;
    const usdcSlot2Key = `0x${(BigInt(usdcProbe.key) + 1n)
      .toString(16)
      .padStart(64, "0")}` as Hex;
    const eurcSlot2Raw = await readStorage(eurcSlot2Key);
    const usdcSlot2Raw = await readStorage(usdcSlot2Key);
    const eurcSlot2 = decodeSlot2(eurcSlot2Raw);
    const usdcSlot2 = decodeSlot2(usdcSlot2Raw);

    // Sanity: emaPrice/emaConf should match emaView.price/conf.
    if (eurcSlot2.emaPrice !== eurcEma.price || eurcSlot2.emaConf !== eurcEma.conf) {
      throw new Error(
        `[pyth-survey] EURC slot 2 EMA decode mismatch — expected ` +
          `price=${eurcEma.price} conf=${eurcEma.conf}, ` +
          `decoded price=${eurcSlot2.emaPrice} conf=${eurcSlot2.emaConf}. ` +
          `Struct packing assumption is wrong; refusing to write manifest.`,
      );
    }
    if (usdcSlot2.emaPrice !== usdcEma.price || usdcSlot2.emaConf !== usdcEma.conf) {
      throw new Error(
        `[pyth-survey] USDC slot 2 EMA decode mismatch — expected ` +
          `price=${usdcEma.price} conf=${usdcEma.conf}, ` +
          `decoded price=${usdcSlot2.emaPrice} conf=${usdcSlot2.emaConf}.`,
      );
    }

    found = {
      mappingSlot: i,
      eurc: {
        label: "EURC",
        feedId: FEED_IDS.EURC,
        priceSlot: eurcProbe.key,
        slot1Raw: eurcProbe.slot1Raw,
        slot2Raw: eurcSlot2Raw,
        decodedSlot1: eurcProbe.decoded,
        decodedSlot2: eurcSlot2,
        view: eurcView,
        emaView: eurcEma,
      },
      usdc: {
        label: "USDC",
        feedId: FEED_IDS.USDC,
        priceSlot: usdcProbe.key,
        slot1Raw: usdcProbe.slot1Raw,
        slot2Raw: usdcSlot2Raw,
        decodedSlot1: usdcProbe.decoded,
        decodedSlot2: usdcSlot2,
        view: usdcView,
        emaView: usdcEma,
      },
    };
    break;
  }

  if (!found) {
    // eslint-disable-next-line no-console
    console.error(
      `[pyth-survey] FAILED: no mapping slot in 0..${MAX_PROBE_SLOT} matched both ` +
        `EURC and USDC view data. Pyth implementation may have been upgraded to ` +
        `a layout we don't understand — re-read PythInternalStructs.PriceInfo and ` +
        `PythStorage.State on the live commit.`,
    );
    process.exit(1);
  }

  // ── Emit manifest ───────────────────────────────────────────────────────

  const manifest = {
    Pyth: PYTH_CONTRACT,
    chainId: ARC_CHAIN_ID,
    verifiedAt: new Date().toISOString(),
    verifiedAtBlock: blockNumber.toString(),
    slots: {
      // The mapping field position inside PythStorage.State that holds
      // the live `latestPriceInfo` mapping (the post-V2 one, NOT the
      // deprecated V1/V2 maps).
      priceInfoMapping: slotToHex32(found.mappingSlot),
      feeds: {
        EURC: { feedId: FEED_IDS.EURC, priceSlot: found.eurc.priceSlot },
        USDC: { feedId: FEED_IDS.USDC, priceSlot: found.usdc.priceSlot },
      },
    },
    structPacking: {
      // Byte offsets inside a single 32-byte EVM word, LSB-first
      // (Solidity packing convention). Match the order in
      // PythInternalStructs.PriceInfo on the upstream commit.
      priceInfoSlot1: {
        publishTime: { offset: 0, size: 8, type: "uint64" },
        expo: { offset: 8, size: 4, type: "int32" },
        price: { offset: 12, size: 8, type: "int64" },
        conf: { offset: 20, size: 8, type: "uint64" },
      },
      priceInfoSlot2: {
        emaPrice: { offset: 0, size: 8, type: "int64" },
        emaConf: { offset: 8, size: 8, type: "uint64" },
      },
    },
    // Snapshot of the live values at survey time — purely informational,
    // not consumed by the cheat helper (it reads current slot bytes
    // before writing to preserve expo).
    values: {
      EURC: {
        priceSlot1: found.eurc.slot1Raw,
        priceSlot2: found.eurc.slot2Raw,
        decoded: {
          publishTime: found.eurc.decodedSlot1.publishTime.toString(),
          expo: found.eurc.decodedSlot1.expo.toString(),
          price: found.eurc.decodedSlot1.price.toString(),
          conf: found.eurc.decodedSlot1.conf.toString(),
          emaPrice: found.eurc.decodedSlot2.emaPrice.toString(),
          emaConf: found.eurc.decodedSlot2.emaConf.toString(),
        },
      },
      USDC: {
        priceSlot1: found.usdc.slot1Raw,
        priceSlot2: found.usdc.slot2Raw,
        decoded: {
          publishTime: found.usdc.decodedSlot1.publishTime.toString(),
          expo: found.usdc.decodedSlot1.expo.toString(),
          price: found.usdc.decodedSlot1.price.toString(),
          conf: found.usdc.decodedSlot1.conf.toString(),
          emaPrice: found.usdc.decodedSlot2.emaPrice.toString(),
          emaConf: found.usdc.decodedSlot2.emaConf.toString(),
        },
      },
    },
  } as const;

  const outPath = resolve(
    import.meta.dir ?? new URL(".", import.meta.url).pathname,
    "pyth-slots.json",
  );
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`[pyth-survey] wrote ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[pyth-survey] EURC slot1 ${found.eurc.priceSlot} = ${found.eurc.slot1Raw} ` +
      `(price=${found.eurc.decodedSlot1.price} expo=${found.eurc.decodedSlot1.expo})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[pyth-survey] USDC slot1 ${found.usdc.priceSlot} = ${found.usdc.slot1Raw} ` +
      `(price=${found.usdc.decodedSlot1.price} expo=${found.usdc.decodedSlot1.expo})`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[pyth-survey] fatal:", err);
  process.exit(1);
});
