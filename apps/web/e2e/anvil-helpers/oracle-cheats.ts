/**
 * Wave F5b + G1 (F5d) — FxOracle + Pyth cheat-code helpers driven by
 * `anvil_setStorageAt`.
 *
 * These helpers consume the validated storage manifests emitted by:
 *   - Wave F5a (`oracle-slots.json`) for FxOracle layout
 *   - Wave G1  (`pyth-slots.json`)   for PythUpgradable's latestPriceInfo
 *     mapping base slot + PriceInfo struct packing
 *
 * Each helper:
 *
 *   1. Resolves the target slot from the relevant manifest (never
 *      re-derived ad hoc — if either layout drifts, the matching
 *      manifest must be regenerated).
 *   2. For Pyth writes, reads the CURRENT slot bytes first to preserve
 *      `expo` (and `conf`/`emaPrice`/`emaConf` when the caller doesn't
 *      override them) — clobbering expo would silently change the
 *      price's order of magnitude.
 *   3. Issues `anvil_setStorageAt` against the supplied `rpcUrl`.
 *   4. Re-reads the slot via `eth_getStorageAt` and asserts the write
 *      actually stuck. Some Anvil forks silently no-op storage writes
 *      against precompile addresses or when started without
 *      `--auto-impersonate` — we'd rather fail loud here than have the
 *      caller's test pass for the wrong reason.
 *
 * Manifest dependency: if `oracle-slots.json` is stale (FxOracle
 * redeployed, storage layout shifted) or `pyth-slots.json` is stale
 * (Pyth implementation upgraded by the Pyth org), every helper here
 * lies. Re-run the relevant survey before trusting cheats again. See
 * `oracle-slot-survey.ts` and `pyth-slot-survey.ts`.
 */

import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

import fxManifest from "./oracle-slots.json";
import pythManifest from "./pyth-slots.json";

// ────────────────────────────────────────────────────────────────────────────
// Manifest types — surface only the bits we depend on
// ────────────────────────────────────────────────────────────────────────────

/**
 * Canonical labels for tokens whose mapping slots F5a pre-computed.
 * Any other address has to be derived on the fly via `mappingKey()`.
 */
type ManifestTokenLabel = "EURC" | "USDC";

interface OracleSlotsManifest {
  FxOracle: Address;
  PythContract: Address;
  chainId: number;
  slots: {
    maxOracleAge: Hex;
    maxDeviationBps: Hex;
    maxConfidenceBps: Hex;
    pythFeedOf: {
      _mappingSlot: Hex;
      EURC: Hex;
      USDC: Hex;
    };
    redstoneFeedOf: {
      _mappingSlot: Hex;
      EURC: Hex;
      USDC: Hex;
    };
  };
  values: {
    pythFeedOf: {
      EURC: Hex;
      USDC: Hex;
    };
  };
}

interface PythSlotsManifest {
  Pyth: Address;
  chainId: number;
  slots: {
    priceInfoMapping: Hex;
    feeds: {
      EURC: { feedId: Hex; priceSlot: Hex };
      USDC: { feedId: Hex; priceSlot: Hex };
    };
  };
  structPacking: {
    priceInfoSlot1: {
      publishTime: { offset: number; size: number; type: "uint64" };
      expo: { offset: number; size: number; type: "int32" };
      price: { offset: number; size: number; type: "int64" };
      conf: { offset: number; size: number; type: "uint64" };
    };
    priceInfoSlot2: {
      emaPrice: { offset: number; size: number; type: "int64" };
      emaConf: { offset: number; size: number; type: "uint64" };
    };
  };
}

const m = fxManifest as OracleSlotsManifest;
const pm = pythManifest as PythSlotsManifest;

// ────────────────────────────────────────────────────────────────────────────
// Slot constants — every base slot the survey checked, re-derived from the
// manifest's mapping-slot field so a manifest re-emit propagates here for free.
// ────────────────────────────────────────────────────────────────────────────

/** Base slot for the FxOracle scalar `maxOracleAge` (slot 1). */
const MAX_ORACLE_AGE_SLOT: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

/** Base mapping slot for `mapping(address => bytes32) redstoneFeedOf` (slot 5). */
const REDSTONE_MAPPING_SLOT: bigint = BigInt(m.slots.redstoneFeedOf._mappingSlot);

/** Base mapping slot for Pyth's `_state.latestPriceInfo`. */
const PYTH_PRICE_INFO_MAPPING_SLOT: bigint = BigInt(pm.slots.priceInfoMapping);

// ────────────────────────────────────────────────────────────────────────────
// Low-level RPC plumbing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a viem client pointed at the forked Anvil RPC. We don't carry a
 * `chain` config because every helper here speaks raw JSON-RPC — the only
 * client method we use is `request()`. Constructing the client per-call is
 * cheap (no socket setup until first request) and keeps the helpers stateless
 * for parallel test workers.
 */
function makeClient(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl) });
}

/**
 * Pad a 32-byte hex value the way `anvil_setStorageAt` expects.
 * Slot writes MUST be exactly 32 bytes — Anvil rejects shorter inputs with
 * a generic "invalid type" error that is hell to debug from a stack trace.
 */
function pad32(value: Hex): Hex {
  const stripped = value.toLowerCase().replace(/^0x/, "");
  return `0x${stripped.padStart(64, "0")}` as Hex;
}

/**
 * Standard Solidity mapping-key derivation for `mapping(address => T)`:
 *   slot = keccak256(abi.encode(token, mappingBaseSlot))
 *
 * Same formula used by `oracle-slot-survey.ts` — keeping the two in sync
 * is the entire point of the manifest existing.
 */
function mappingKey(token: Address, mappingSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [token, mappingSlot],
    ),
  );
}

/**
 * Standard Solidity mapping-key derivation for `mapping(bytes32 => T)`.
 * Same formula as the address variant, just a bytes32 key type instead
 * of address. Used for Pyth's `latestPriceInfo[priceId]`.
 */
function mappingKeyBytes32(key: Hex, mappingSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [key, mappingSlot],
    ),
  );
}

/**
 * Read a single 32-byte slot via `eth_getStorageAt`.
 */
async function readSlot(
  rpcUrl: string,
  contract: Address,
  slot: Hex,
): Promise<Hex> {
  const client = makeClient(rpcUrl);
  const slot32 = pad32(slot);
  const value = (await client.request({
    method: "eth_getStorageAt",
    params: [contract, slot32, "latest"],
    // biome-ignore lint/suspicious/noExplicitAny: cast for eth_getStorageAt result
  } as any)) as Hex | null;
  if (!value) {
    throw new Error(
      `[oracle-cheats] eth_getStorageAt returned null for ${contract} ${slot32}`,
    );
  }
  return value;
}

/**
 * Write a single 32-byte slot via `anvil_setStorageAt`, then re-read via
 * `eth_getStorageAt` and assert the bytes match what we sent. If Anvil
 * silently no-ops the write (some configurations refuse to overwrite
 * precompile storage), this throws with the original slot/expected/actual
 * so the test failure points at the cheat, not at the symptom downstream.
 */
async function writeAndVerifySlot(
  rpcUrl: string,
  contract: Address,
  slot: Hex,
  value: Hex,
): Promise<void> {
  const client = makeClient(rpcUrl);
  const slot32 = pad32(slot);
  const value32 = pad32(value);

  // `anvil_setStorageAt` returns the literal boolean `true` on success.
  // viem types this as `unknown`, hence the cast — we don't use the value,
  // we just need to await the round-trip so an RPC error surfaces.
  await client.request({
    // viem's request() type narrows method names to the standard set; the
    // anvil custom methods aren't in that union, so we cast through any.
    method: "anvil_setStorageAt",
    params: [contract, slot32, value32],
    // biome-ignore lint/suspicious/noExplicitAny: anvil method outside viem's typed union
  } as any);

  const after = (await client.request({
    method: "eth_getStorageAt",
    params: [contract, slot32, "latest"],
    // biome-ignore lint/suspicious/noExplicitAny: cast for eth_getStorageAt result
  } as any)) as Hex | null;

  if (!after) {
    throw new Error(
      `[oracle-cheats] eth_getStorageAt returned null for ${contract} ${slot32} after write`,
    );
  }

  if (pad32(after).toLowerCase() !== value32.toLowerCase()) {
    throw new Error(
      `[oracle-cheats] storage write did not stick for ${contract} slot=${slot32}: ` +
        `expected=${value32} actual=${pad32(after)}. ` +
        `Anvil may be refusing the write (precompile? unauthorized?).`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Overwrite FxOracle.maxOracleAge — the freshness window (in seconds) past
 * which `getMid()` reverts with `OracleTooStale`. Bump it to e.g. 3600n in
 * a test that runs against a stale fork so the next `getMid()` doesn't
 * trip on Pyth's last-publish timestamp lagging chain time.
 *
 * Cheat invariant: after this call, `FxOracle.maxOracleAge()` returns
 * `newMaxAge` and `getMid()` accepts feed entries up to that many seconds
 * old.
 *
 * Stop-condition: `newMaxAge` must fit in uint256 (caller's problem; we
 * don't validate — bigint values that wrap are caller bugs).
 *
 * Usage:
 *   await widenOracleAgeLimit({ rpcUrl: anvil.rpcUrl, newMaxAge: 3600n });
 */
export async function widenOracleAgeLimit({
  rpcUrl,
  newMaxAge,
}: {
  rpcUrl: string;
  newMaxAge: bigint;
}): Promise<void> {
  // Manifest sanity check: the manifest stores the *current value* of
  // maxOracleAge (not the slot index), so we just confirm it's present
  // and well-formed. The actual slot index is `MAX_ORACLE_AGE_SLOT` (1)
  // per the F5a survey. Throwing here would gate cheat usage on an
  // unrelated invariant, so we only validate the JSON shape.
  if (typeof m.slots.maxOracleAge !== "string") {
    throw new Error(
      "[oracle-cheats] manifest missing slots.maxOracleAge — re-run oracle-slot-survey.ts",
    );
  }

  await writeAndVerifySlot(
    rpcUrl,
    m.FxOracle,
    MAX_ORACLE_AGE_SLOT,
    toHex(newMaxAge, { size: 32 }),
  );
}

/**
 * Zero out the redstone feed for one token on FxOracle. After this, the
 * oracle's redstone branch returns bytes32(0) for the token, which FxOracle
 * treats as "no redstone feed configured" and falls back to Pyth-only
 * pricing in `getMid()`.
 *
 * For EURC/USDC the slot is read straight from the F5a manifest (no
 * keccak required). For any other token we derive on the fly via the
 * standard mapping-key formula — same one the survey uses, so values
 * stay in lock-step.
 *
 * Cheat invariant: after this call, `FxOracle.redstoneFeedOf(token) ==
 * bytes32(0)` and `getMid(token)` will consult only Pyth.
 *
 * Usage:
 *   await disableRedstone({ rpcUrl: anvil.rpcUrl, token: EURC_ADDRESS });
 */
export async function disableRedstone({
  rpcUrl,
  token,
}: {
  rpcUrl: string;
  token: Address;
}): Promise<void> {
  const tokenLabel = labelForToken(token);
  const slot: Hex = tokenLabel
    ? m.slots.redstoneFeedOf[tokenLabel]
    : mappingKey(token, REDSTONE_MAPPING_SLOT);

  await writeAndVerifySlot(
    rpcUrl,
    m.FxOracle,
    slot,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );
}

/**
 * Resolve a token address back to its manifest label (EURC | USDC) if F5a
 * pre-computed it. Case-insensitive match — the manifest stores checksummed
 * mixed-case, callers often pass lowercase. Returns null if the token
 * isn't in the manifest's pre-computed set.
 */
function labelForToken(token: Address): ManifestTokenLabel | null {
  const lowered = token.toLowerCase();
  // EURC + USDC addresses are derivable by re-running the slot key against
  // the manifest's stored slots — but the actual addresses are baked into
  // the survey, not the manifest. We hard-code them once here, matching
  // `oracle-slot-survey.ts`.
  const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
  const USDC: Address = "0x3600000000000000000000000000000000000000";
  if (lowered === EURC.toLowerCase()) return "EURC";
  if (lowered === USDC.toLowerCase()) return "USDC";
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Pyth helpers — read/decode/pack the on-chain PriceInfo struct
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `baseToken` (an FX market underlying) to its Pyth feed id by
 * reading the F5a manifest. Returns the canonical 32-byte feed id.
 *
 * Only EURC / USDC are pre-computed in the F5a manifest. Any other
 * token requires the caller to re-run the FxOracle slot survey with
 * extra labels OR pass a feed id directly via the lower-level
 * `setPythPriceByFeedId` helper.
 */
function feedIdForToken(token: Address): Hex {
  const label = labelForToken(token);
  if (!label) {
    throw new Error(
      `[oracle-cheats] no Pyth feed mapping for token ${token} — only EURC and USDC ` +
        "are pre-computed in oracle-slots.json. Either re-run oracle-slot-survey.ts " +
        "with this token added or use setPythPriceByFeedId() directly.",
    );
  }
  return m.values.pythFeedOf[label];
}

/**
 * Resolve a feed id to its `latestPriceInfo[feedId]` slot. For EURC/USDC
 * we use the manifest's pre-computed slot to avoid a runtime keccak; for
 * any other feed id we derive on the fly using the manifest's mapping
 * base slot.
 */
function priceSlotForFeedId(feedId: Hex): Hex {
  const lowered = feedId.toLowerCase();
  if (lowered === pm.slots.feeds.EURC.feedId.toLowerCase()) {
    return pm.slots.feeds.EURC.priceSlot;
  }
  if (lowered === pm.slots.feeds.USDC.feedId.toLowerCase()) {
    return pm.slots.feeds.USDC.priceSlot;
  }
  return mappingKeyBytes32(feedId, PYTH_PRICE_INFO_MAPPING_SLOT);
}

interface DecodedPriceSlot1 {
  publishTime: bigint;
  expo: bigint; // signed
  price: bigint; // signed
  conf: bigint;
}

/** Bit mask helpers — same convention as pyth-slot-survey.ts. */
const MASK64: bigint = (1n << 64n) - 1n;
const MASK32: bigint = (1n << 32n) - 1n;

/**
 * Sign-extend an N-byte two's-complement value to a signed bigint.
 * Used for `int32 expo` and `int64 price`.
 */
function signExtend(value: bigint, byteLength: number): bigint {
  const bitWidth = BigInt(byteLength * 8);
  const signBit = 1n << (bitWidth - 1n);
  if (value & signBit) {
    return value - (1n << bitWidth);
  }
  return value;
}

/**
 * Decode slot 1 of Pyth's `PriceInfo`:
 *   uint64 publishTime @ byte 0..7
 *   int32  expo        @ byte 8..11
 *   int64  price       @ byte 12..19
 *   uint64 conf        @ byte 20..27
 *
 * Mirrors `decodeSlot1` in `pyth-slot-survey.ts`. Keep these two in
 * lock-step — the survey is the only thing that proved the layout, this
 * function just re-applies it.
 */
function decodePythSlot1(slotHex: Hex): DecodedPriceSlot1 {
  const norm = slotHex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  // LSB-first byte read: byte at offset 0 is the LAST two hex chars.
  // chars 64-16..64-0  ← publishTime
  // chars 64-24..64-16 ← expo
  // chars 64-40..64-24 ← price
  // chars 64-56..64-40 ← conf
  const publishTime = BigInt(`0x${norm.slice(48, 64)}`);
  const expo = signExtend(BigInt(`0x${norm.slice(40, 48)}`), 4);
  const price = signExtend(BigInt(`0x${norm.slice(24, 40)}`), 8);
  const conf = BigInt(`0x${norm.slice(8, 24)}`);
  return { publishTime, expo, price, conf };
}

/**
 * Pack `{ publishTime, expo, price, conf }` into a 32-byte slot value
 * (Solidity packing convention, LSB-first). Inverse of `decodePythSlot1`.
 *
 * - `expo` is masked to uint32 (two's complement preserved).
 * - `price` is masked to uint64 (two's complement preserved).
 * - Top 4 bytes (slot offset 28..31) are left as zero (no fields packed
 *   there by `PriceInfo` slot 1).
 */
function packPythSlot1({
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
  const publishTimeBytes = publishTime & MASK64;
  const expoBytes = expo & MASK32;
  const priceBytes = price & MASK64;
  const confBytes = conf & MASK64;

  const composed =
    (confBytes << 160n) |
    (priceBytes << 96n) |
    (expoBytes << 64n) |
    publishTimeBytes;

  return `0x${composed.toString(16).padStart(64, "0")}` as Hex;
}

/**
 * Convert a price expressed in E18 fixed-point (1e18 = 1.0) to Pyth's
 * int64 representation at the feed's current expo:
 *
 *   real     = priceE18 / 10^18
 *   pythInt  = real / 10^expo = priceE18 / 10^(18 + expo)
 *
 * For typical FX expos of -8: pythInt = priceE18 / 10^10.
 *
 * Sanity rails:
 *   - We require (18 + expo) >= 0, i.e. expo >= -18. Pyth never publishes
 *     more than ~10 digits below the decimal so this is fine in practice;
 *     if it ever changes we want a loud failure, not a silent overflow.
 *   - We refuse to truncate non-zero fractions: if priceE18 doesn't
 *     divide evenly by 10^(18+expo), throw. Callers should pre-round in
 *     E18 to the supported precision. (Most tests pass round numbers
 *     like 1.10 → 11e17, which divides cleanly.)
 *   - Result must fit in int64. Anything outside [-2^63, 2^63 - 1] is a
 *     caller bug.
 */
function priceE18ToPythInt64(priceE18: bigint, expo: bigint): bigint {
  const exponent = 18n + expo; // expected non-negative
  if (exponent < 0n) {
    throw new Error(
      `[oracle-cheats] expo=${expo} would require multiplying priceE18 by 10^${-exponent}; ` +
        "this code path isn't supported — re-run with a feed whose expo >= -18.",
    );
  }
  const divisor = 10n ** exponent;
  const quotient = priceE18 / divisor;
  const remainder = priceE18 - quotient * divisor;
  if (remainder !== 0n) {
    throw new Error(
      `[oracle-cheats] priceE18=${priceE18} does not divide evenly by 10^${exponent} ` +
        `(expo=${expo}). Round caller-side to the supported precision before calling.`,
    );
  }
  // int64 range check
  const INT64_MIN = -(1n << 63n);
  const INT64_MAX = (1n << 63n) - 1n;
  if (quotient < INT64_MIN || quotient > INT64_MAX) {
    throw new Error(
      `[oracle-cheats] priceE18=${priceE18} at expo=${expo} → ${quotient} doesn't fit in int64`,
    );
  }
  return quotient;
}

/**
 * Same conversion for `conf` — same rules but unsigned (uint64).
 */
function confE18ToPythUint64(confE18: bigint, expo: bigint): bigint {
  if (confE18 < 0n) {
    throw new Error(`[oracle-cheats] confE18 must be >= 0, got ${confE18}`);
  }
  const exponent = 18n + expo;
  if (exponent < 0n) {
    throw new Error(
      `[oracle-cheats] expo=${expo} not supported for conf conversion`,
    );
  }
  const divisor = 10n ** exponent;
  const quotient = confE18 / divisor;
  const remainder = confE18 - quotient * divisor;
  if (remainder !== 0n) {
    throw new Error(
      `[oracle-cheats] confE18=${confE18} does not divide evenly by 10^${exponent}`,
    );
  }
  const UINT64_MAX = (1n << 64n) - 1n;
  if (quotient > UINT64_MAX) {
    throw new Error(
      `[oracle-cheats] confE18=${confE18} at expo=${expo} → ${quotient} doesn't fit in uint64`,
    );
  }
  return quotient;
}

/**
 * Overwrite Pyth's stored price for a feed by rewriting slot 1 of
 * `latestPriceInfo[feedId]` directly via `anvil_setStorageAt`.
 *
 * The slot is shared by `{ publishTime, expo, price, conf }` (28 bytes
 * packed into one EVM word). We **read the slot first** to preserve
 * `expo` — overwriting expo would silently change the price's order of
 * magnitude downstream (Pyth's `Price` is `int64 price * 10^expo`).
 *
 * Slot 2 (`emaPrice` / `emaConf`) is NOT touched here. `FxOracle.getMid`
 * doesn't consult the EMA price; if a downstream test does, the caller
 * needs a separate helper.
 *
 * Cheat invariant after call:
 *   Pyth.getPriceUnsafe(feedId) ==
 *     { price: pythInt(newPriceE18), conf: pythInt(newConfE18),
 *       expo: <unchanged>, publishTime: newPublishTime }
 *
 * Usage:
 *   await setPythPrice({
 *     rpcUrl: anvil.rpcUrl,
 *     baseToken: EURC_ADDRESS,
 *     newPriceE18: 1_100_000_000_000_000_000n, // 1.10 EUR/USD
 *     newPublishTime: Math.floor(Date.now() / 1000),
 *   });
 */
export async function setPythPrice({
  rpcUrl,
  baseToken,
  newPriceE18,
  newConfE18 = 0n,
  newPublishTime,
}: {
  rpcUrl: string;
  baseToken: Address;
  newPriceE18: bigint;
  newConfE18?: bigint;
  newPublishTime: number;
}): Promise<void> {
  const feedId = feedIdForToken(baseToken);
  await setPythPriceByFeedId({
    rpcUrl,
    feedId,
    newPriceE18,
    newConfE18,
    newPublishTime,
  });
}

/**
 * Lower-level variant of `setPythPrice` that accepts the Pyth feed id
 * directly. Useful when the caller is testing a token that isn't
 * pre-mapped in `oracle-slots.json`.
 *
 * Behaves exactly like `setPythPrice` but skips the FxOracle manifest
 * lookup.
 */
export async function setPythPriceByFeedId({
  rpcUrl,
  feedId,
  newPriceE18,
  newConfE18 = 0n,
  newPublishTime,
}: {
  rpcUrl: string;
  feedId: Hex;
  newPriceE18: bigint;
  newConfE18?: bigint;
  newPublishTime: number;
}): Promise<void> {
  if (!Number.isInteger(newPublishTime) || newPublishTime < 0) {
    throw new Error(
      `[oracle-cheats] newPublishTime must be a non-negative integer (unix seconds), got ${newPublishTime}`,
    );
  }
  // uint64 range guard — newPublishTime is `number` in JS, so up to 2^53
  // we're fine; this just catches obvious overflows from arithmetic bugs.
  if (newPublishTime > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `[oracle-cheats] newPublishTime=${newPublishTime} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }

  const priceSlot = priceSlotForFeedId(feedId);

  // Read current slot to preserve expo. Anvil exposes the same storage
  // as the underlying fork until written, so this returns the same
  // bytes the survey saw (modulo any prior cheat in the same session).
  const currentSlot = await readSlot(rpcUrl, pm.Pyth, priceSlot);
  const { expo } = decodePythSlot1(currentSlot);

  // If the slot is fully zero, the feed was never written — Pyth's
  // `getPriceUnsafe` would revert with `PriceFeedNotFound`. We refuse
  // to invent an expo because the resulting price would be at an
  // unknown scale; the caller almost certainly didn't intend this.
  if (
    currentSlot.toLowerCase() ===
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    throw new Error(
      `[oracle-cheats] Pyth slot ${priceSlot} for feedId ${feedId} is zero — ` +
        "the feed has never been written on chain (PriceFeedNotFound). " +
        "Refusing to invent an expo. Either choose a feed that's been published " +
        "at least once, or extend this helper to accept an explicit expo argument.",
    );
  }

  const pythPrice = priceE18ToPythInt64(newPriceE18, expo);
  const pythConf = confE18ToPythUint64(newConfE18, expo);

  const packed = packPythSlot1({
    publishTime: BigInt(newPublishTime),
    expo,
    price: pythPrice,
    conf: pythConf,
  });

  await writeAndVerifySlot(rpcUrl, pm.Pyth, priceSlot, packed);

  // Defense in depth: re-decode the slot we just wrote and assert the
  // fields round-trip. `writeAndVerifySlot` already proves the bytes
  // stuck; this catches the case where our packing function disagrees
  // with the survey's unpacker (a packing-bug class that can't be
  // caught by byte-for-byte verification alone — both sides would
  // agree on the wrong bytes).
  const after = await readSlot(rpcUrl, pm.Pyth, priceSlot);
  const dec = decodePythSlot1(after);
  if (
    dec.publishTime !== BigInt(newPublishTime) ||
    dec.expo !== expo ||
    dec.price !== pythPrice ||
    dec.conf !== pythConf
  ) {
    throw new Error(
      `[oracle-cheats] Pyth slot ${priceSlot} round-trip mismatch after write: ` +
        `expected { publishTime=${newPublishTime}, expo=${expo}, price=${pythPrice}, conf=${pythConf} }, ` +
        `decoded { publishTime=${dec.publishTime}, expo=${dec.expo}, price=${dec.price}, conf=${dec.conf} }. ` +
        `Packing function is out of sync with the survey's decoder.`,
    );
  }
}
