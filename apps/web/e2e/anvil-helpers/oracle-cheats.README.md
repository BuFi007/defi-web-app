# `oracle-cheats.ts` — FxOracle storage-rewrite helpers (Wave F5b)

Thin wrappers over `anvil_setStorageAt` that rewrite specific slots on the
deployed `FxOracle` contract (`0x77b3A3B420dB98B01085b8C46a753Ed9879e2865`)
inside a forked Anvil node. Used by the perp e2e suite to force oracle
state — stale prices, missing feeds, widened freshness windows — without
waiting on the real upstream feeds.

## Manifest dependency — this is load-bearing

Every helper here reads `oracle-slots.json`, the validated storage manifest
emitted by **Wave F5a** (`oracle-slot-survey.ts`). If the deployed FxOracle
is re-deployed, upgraded, or has its storage layout shifted by a source
refactor, the manifest goes stale and **every helper here will silently
write to the wrong slot**. Inline self-validation (re-read after write)
catches the case where Anvil rejects the write outright, but it cannot
catch a manifest pointing at the wrong field.

Before trusting these cheats against a new fork:

```bash
bun run apps/web/e2e/anvil-helpers/oracle-slot-survey.ts
```

If the survey passes (all rows `OK`), the manifest is current and these
helpers are safe.

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

## Helper deferred — `setPythPrice`

`setPythPrice({ rpcUrl, baseToken, newPriceE18, newPublishTime })` is
**not shipped in this wave**. See the long comment block at the bottom of
`oracle-cheats.ts` and the `SET_PYTH_PRICE_DEFERRED` export.

### Why deferred

FxOracle resolves `baseToken` → `feedId` via `pythFeedOf`, then calls into
the Pyth proxy at `manifest.PythContract` (`0x2880aB155794e7179c9eE2e38200202908C17B43`).
Pyth (`PythUpgradable`) stores prices in a mapping whose value is the
packed `PriceFeed` struct:

```solidity
struct PriceFeed {
  int64  price;
  uint64 conf;
  int32  expo;
  uint64 publishTime;
  // …emaPrice fields…
}
```

That struct packs across multiple slots, **and** the base mapping slot
inside the proxy's storage layout depends on the upgrade history. Doing a
`forge inspect`-grade bytecode survey here would blow the F5b budget and
ship a brittle helper that breaks on the next Pyth upgrade.

### Plan

A future wave (F5d or later) will:

1. Survey Pyth's deployed bytecode against the upstream
   `@pythnetwork/pyth-sdk-solidity` source to pin the proxy's storage layout.
2. Emit `pyth-slots.json` analogous to `oracle-slots.json`.
3. Add `setPythPrice` here, consuming that manifest.

### Caller workaround in the meantime

Tests that need a synthetic Pyth price can either:

- **Force Pyth-only routing** via `disableRedstone(token)` and accept the
  Pyth price as of the forked block (typically fine for tests that only
  care about deviation, not absolute price).
- **Skip under fork mode** — `test.skip(process.env.PERPS_E2E_FORK_ARC === "1", "needs setPythPrice — F5b deferred")`
  and run the test only against the dev mock oracle.

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

`oracle-slots.json` was emitted by `oracle-slot-survey.ts` against Arc
Testnet (chain id 5042002, block 43228147). The deployed FxOracle is the
Ownable variant from commit `e98db26` of the sibling `fx-telarana` repo —
**not** the later `feat/privacy-hook-slice-3-crossccy` source which moves
to AccessControl and shifts slots. If that branch ever lands and FxOracle
is re-deployed, every helper here needs the manifest re-emitted first.

See `oracle-slot-survey.ts` lines 14–30 for the full layout note.
