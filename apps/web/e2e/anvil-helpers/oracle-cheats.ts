/**
 * Wave F5b — FxOracle cheat-code helpers driven by `anvil_setStorageAt`.
 *
 * These helpers consume the validated storage manifest emitted by Wave F5a
 * (`oracle-slots.json`) to rewrite specific FxOracle slots on a forked
 * Anvil node. Each helper:
 *
 *   1. Resolves the target slot from the F5a manifest (never re-derived
 *      ad hoc — if the layout drifts the manifest must be regenerated).
 *   2. Issues `anvil_setStorageAt` against the supplied `rpcUrl`.
 *   3. Re-reads the slot via `eth_getStorageAt` and asserts the write
 *      actually stuck. Some Anvil forks silently no-op storage writes
 *      against precompile addresses or when started without
 *      `--auto-impersonate` — we'd rather fail loud here than have the
 *      caller's test pass for the wrong reason.
 *
 * Manifest dependency: if `oracle-slots.json` is stale (FxOracle redeployed,
 * storage layout shifted) every helper here lies. Re-run the F5a survey
 * before trusting cheats again. See `oracle-slot-survey.ts`.
 *
 * Out of scope (this wave): `setPythPrice`. Pyth's `PythUpgradable` packs
 * a price struct (`int64 price | uint64 conf | int32 expo | uint64 publishTime`)
 * into a mapping whose base slot depends on the deployed proxy's layout — a
 * deeper bytecode survey is required before we can write to it safely.
 * Tracked as a TODO in the README.
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

import manifest from "./oracle-slots.json";

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
}

const m = manifest as OracleSlotsManifest;

// ────────────────────────────────────────────────────────────────────────────
// Slot constants — every base slot the survey checked, re-derived from the
// manifest's mapping-slot field so a manifest re-emit propagates here for free.
// ────────────────────────────────────────────────────────────────────────────

/** Base slot for the FxOracle scalar `maxOracleAge` (slot 1). */
const MAX_ORACLE_AGE_SLOT: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

/** Base mapping slot for `mapping(address => bytes32) redstoneFeedOf` (slot 5). */
const REDSTONE_MAPPING_SLOT: bigint = BigInt(m.slots.redstoneFeedOf._mappingSlot);

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
 * Standard Solidity mapping-key derivation:
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
// setPythPrice — DEFERRED to a follow-up wave.
//
// Why deferred:
//   FxOracle resolves baseToken → feedId via `pythFeedOf`, then calls into
//   the Pyth proxy at `manifest.PythContract`. Pyth (`PythUpgradable`)
//   stores prices in a mapping whose value type is the packed `PriceFeed`
//   struct:
//     struct PriceFeed {
//       int64  price;
//       uint64 conf;
//       int32  expo;
//       uint64 publishTime;
//       // …emaPrice fields…
//     }
//   That packs across multiple slots, and the base-mapping slot inside the
//   proxy's storage layout depends on the upgrade history — a `forge
//   inspect`-grade survey against the deployed bytecode is required before
//   any storage write can be trusted. Doing that survey here would blow
//   the F5b budget and produce a fragile helper.
//
// Plan:
//   Wave F5d (or later) — run a Pyth-specific survey script analogous to
//   `oracle-slot-survey.ts`, emit `pyth-slots.json`, then add `setPythPrice`
//   here using that manifest.
//
// Caller workaround in the meantime:
//   Tests that need a synthetic price can call `disableRedstone(token)` to
//   force Pyth-only routing, then either
//     (a) accept whatever Pyth's last-published price was on the forked
//         block, or
//     (b) skip the test under `PERPS_E2E_FORK_ARC=1` with a TODO pointing
//         at this comment.
// ────────────────────────────────────────────────────────────────────────────

export const SET_PYTH_PRICE_DEFERRED = {
  reason:
    "Pyth PriceFeed struct packing requires a dedicated bytecode survey — " +
    "see Wave F5b README. Use disableRedstone() + fork-block price in the meantime.",
} as const;
