# `oracle-cheats.ts` — FxOracle + Pyth storage-rewrite helpers (Waves F5b + G1)

Thin wrappers over `anvil_setStorageAt` that rewrite specific slots on the
deployed `FxOracle` (`0x77b3A3B420dB98B01085b8C46a753Ed9879e2865`) and
Pyth proxy (`0x2880aB155794e7179c9eE2e38200202908C17B43`) contracts inside
a forked Anvil node. Used by the perp e2e suite to force oracle state —
stale prices, missing feeds, widened freshness windows, synthetic Pyth
prices — without waiting on the real upstream feeds.

## Manifest dependency — this is load-bearing

Every helper here reads one (or both) of:

- `oracle-slots.json` — validated FxOracle layout, emitted by **Wave F5a**
  (`oracle-slot-survey.ts`).
- `pyth-slots.json` — validated Pyth `latestPriceInfo` mapping slot and
  `PriceInfo` struct packing, emitted by **Wave G1**
  (`pyth-slot-survey.ts`).

If FxOracle is re-deployed/upgraded, or if Pyth's UUPS implementation is
upgraded by the Pyth org (the proxy can flip implementation at any time
without a notification), the relevant manifest goes stale and **every
helper that consumes it will silently write to the wrong slot**. Inline
self-validation (re-read after write, round-trip decode for Pyth) catches
the case where Anvil rejects the write outright, but it cannot catch a
manifest pointing at the wrong field.

Before trusting these cheats against a new fork:

```bash
bun run apps/web/e2e/anvil-helpers/oracle-slot-survey.ts
bun run apps/web/e2e/anvil-helpers/pyth-slot-survey.ts
```

If both surveys exit zero, both manifests are current and these helpers
are safe.

## Helpers shipped

### `widenOracleAgeLimit({ rpcUrl, newMaxAge })`

Overwrites `FxOracle.maxOracleAge` (slot 1). Bump the freshness window so
`getMid()` accepts feed entries up to `newMaxAge` seconds old. Use this
when forking against an Arc block where Pyth's last-publish timestamp is
hours behind chain time and `OracleTooStale` would otherwise revert the
test.

```ts
import { widenOracleAgeLimit } from "./oracle-cheats";

await widenOracleAgeLimit({
  rpcUrl: anvil.rpcUrl,
  newMaxAge: 3600n, // 1h
});
```

**Invariant after call**: `FxOracle.maxOracleAge() == newMaxAge`.

### `disableRedstone({ rpcUrl, token })`

Zeroes the `redstoneFeedOf[token]` mapping entry on FxOracle. FxOracle
treats `bytes32(0)` as "no redstone feed configured" and falls back to
Pyth-only pricing inside `getMid()`.

For EURC/USDC the slot is read straight from the manifest's pre-computed
mapping keys (no keccak at runtime). For any other token the slot is
derived on the fly via `keccak256(abi.encode(token, mappingSlot))`, using
the same formula `oracle-slot-survey.ts` uses — values stay in lock-step.

```ts
import { disableRedstone } from "./oracle-cheats";

await disableRedstone({
  rpcUrl: anvil.rpcUrl,
  token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // EURC
});
```

**Invariant after call**: `FxOracle.redstoneFeedOf(token) == bytes32(0)`
and `getMid(token)` consults only the Pyth branch.

### `setPythPrice({ rpcUrl, baseToken, newPriceE18, newConfE18?, newPublishTime })`

Overwrites slot 1 of `Pyth._state.latestPriceInfo[feedId]` for the feed
that backs `baseToken` in FxOracle. The packed slot holds
`{ publishTime: uint64, expo: int32, price: int64, conf: uint64 }` — 28
bytes in one EVM word, LSB-first per Solidity packing rules.

Behaviour notes:

- `baseToken` → `feedId` resolution goes through `oracle-slots.json`
  (`values.pythFeedOf`). Only EURC + USDC are pre-computed; for anything
  else use the lower-level `setPythPriceByFeedId` variant.
- The helper **reads the current slot first** to recover the feed's
  current `expo` and packs the new price at that scale. Overwriting
  `expo` would silently shift the price's order of magnitude — every
  consumer assumes `expo` is stable across a publish.
- `newPriceE18` is converted to Pyth's `int64` via
  `pythPrice = newPriceE18 / 10^(18 + expo)`. We refuse to truncate:
  if `newPriceE18` doesn't divide evenly, the helper throws. Round
  caller-side before calling.
- `newConfE18` defaults to `0n`. Same conversion + divisibility rule
  applies; pass `0n` if you don't care about confidence.
- `newPublishTime` is a unix-seconds integer (uint64-bound).
- Slot 2 (`emaPrice`/`emaConf`) is **not** touched. `FxOracle.getMid`
  doesn't read EMA; if you need to overwrite EMA for a test, add a
  separate helper.

```ts
import { setPythPrice } from "./oracle-cheats";

await setPythPrice({
  rpcUrl: anvil.rpcUrl,
  baseToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // EURC
  newPriceE18: 1_100_000_000_000_000_000n, // 1.10 EUR/USD in E18
  newPublishTime: Math.floor(Date.now() / 1000),
});
```

**Invariant after call**:

```
Pyth.getPriceUnsafe(feedId) == {
  price:       newPriceE18 / 10^(18 + expo),
  conf:        newConfE18  / 10^(18 + expo),
  expo:        <unchanged from pre-write>,
  publishTime: newPublishTime,
}
```

`FxOracle.getMid(baseToken)` will then return a price derived from the
synthetic value (modulo any redstone deviation guards — pair with
`disableRedstone` to force Pyth-only routing).

#### How the cheat self-validates

Two layers of defence:

1. `writeAndVerifySlot` round-trips the bytes via `eth_getStorageAt` and
   throws if Anvil silently no-opped the write.
2. The helper re-decodes the slot it just wrote (using the same
   unpacker the survey used) and asserts each field matches. This
   catches a packing-bug class where the byte-for-byte comparison would
   pass but the meaning would be wrong (writer + reader agree on a
   broken layout).

#### `setPythPriceByFeedId` — lower-level variant

Same behaviour, but accepts a raw `feedId` (bytes32) instead of an
FX-market token address. Use this when testing a token that's not in
`oracle-slots.json`.

## How the writes are validated

Every helper:

1. Sends `anvil_setStorageAt(contract, slot, value)`.
2. Immediately re-reads via `eth_getStorageAt(contract, slot, "latest")`.
3. Asserts the returned bytes match the written bytes (after canonical
   32-byte padding).

If the re-read disagrees, the helper throws with the contract, slot,
expected, and actual bytes. The most common cause is Anvil refusing the
write — some configurations reject storage writes against precompile
addresses (e.g. Arc's USDC at `0x3600…`) or when the fork was started
without the requisite flags. Fail loud at the cheat, never let the
downstream test pass for the wrong reason.

## Manifest provenance

### `oracle-slots.json` (Wave F5a)

Emitted by `oracle-slot-survey.ts` against Arc Testnet (chain id 5042002,
block 43228147). The deployed FxOracle is the Ownable variant from
commit `e98db26` of the sibling `fx-telarana` repo — **not** the later
`feat/privacy-hook-slice-3-crossccy` source which moves to AccessControl
and shifts slots. If that branch ever lands and FxOracle is re-deployed,
every helper here needs the manifest re-emitted first.

See `oracle-slot-survey.ts` lines 14–30 for the full layout note.

### `pyth-slots.json` (Wave G1 / F5d)

Emitted by `pyth-slot-survey.ts` against the same chain. Pyth is a UUPS
proxy at `0x2880aB155794e7179c9eE2e38200202908C17B43`; its implementation
can be upgraded by the Pyth org at any time. The survey does NOT pin a
commit hash — it brute-forces the mapping base slot for
`_state.latestPriceInfo` by probing slots 0..256, computing the standard
mapping key for the EURC and USDC feed ids, and matching the decoded
slot bytes against `getPriceUnsafe` view output. Whichever slot matches
both feeds is the answer (single-feed coincidence is statistically
ruled out at this scan width).

At the time the manifest was emitted the mapping lived at slot
`0xd5` (213 decimal). The `PriceInfo` struct packs into two slots:

- slot 1: `{ publishTime: uint64@0, expo: int32@8, price: int64@12, conf: uint64@20 }`
- slot 2: `{ emaPrice: int64@0, emaConf: uint64@8 }`

`setPythPrice` only touches slot 1 — `FxOracle.getMid` doesn't read EMA.

If Pyth upgrades and the layout shifts (most likely cause: a new field
inserted before `latestPriceInfo` in `PythStorage.State`), the survey
will fail loud and refuse to re-emit until the cause is investigated.
