# `apps/web/e2e/` — Playwright e2e suite

End-to-end tests for the BUFI web app. The arcade / loan / perps-panel
tests run against a live preview; the perps round-trip + liquidation tests
fork Arc Testnet via Anvil so the cheat-code surface (storage rewrites,
time-warp, impersonation) is available.

## Forked-Anvil tests

The perp suite spins up an Anvil fork in `global-setup.ts` when
`PERPS_E2E_FORK_ARC=1`. Without that env var the suite skips itself
gracefully (see `perps-fixtures.ts` `ensureForkOrSkip`). The fork's RPC URL
is written to `e2e/.anvil-runtime/rpc-url.txt`; helpers in `anvil-helpers.ts`
read that file (or `PERPS_E2E_RPC_URL` if set explicitly).

## Oracle cheat chain — F5a → F5b → F5c → F5d

The liquidation tests rely on rewriting `FxOracle` storage on the forked
node to drive prices without waiting on upstream feeds. The cheat surface
is built in waves:

### F5a — `oracle-slot-survey.ts` + `oracle-slots.json`

**Source of truth for every FxOracle slot a cheat writes to.**

`anvil-helpers/oracle-slot-survey.ts` walks the deployed FxOracle
(`0x77b3A3B420dB98B01085b8C46a753Ed9879e2865`) and derives the storage
layout — scalar slots, mapping bases, and pre-computed mapping keys for
EURC + USDC. Output goes to `anvil-helpers/oracle-slots.json`.

Re-run after any FxOracle redeploy or storage-layout-shifting refactor:

```bash
bun run apps/web/e2e/anvil-helpers/oracle-slot-survey.ts
```

If the survey fails (any row not `OK`), the manifest is stale and every
F5b helper that consumes it lies.

### F5b — `anvil-helpers/oracle-cheats.ts`

**Storage-rewrite helpers consuming the F5a manifest.**

Two helpers ship in this wave; `setPythPrice` is deferred to F5d (see
below).

#### `widenOracleAgeLimit({ rpcUrl, newMaxAge })`

Overwrites `FxOracle.maxOracleAge` (slot 1). Bumps the freshness window so
`getMid()` accepts feed entries up to `newMaxAge` seconds old. Use against
a fork whose Pyth publishTime is hours behind chain time and would
otherwise revert `OracleTooStale`.

```ts
import { widenOracleAgeLimit } from "./anvil-helpers/oracle-cheats";
await widenOracleAgeLimit({ rpcUrl, newMaxAge: 3600n });
```

#### `disableRedstone({ rpcUrl, token })`

Zeroes `FxOracle.redstoneFeedOf[token]`. FxOracle treats `bytes32(0)` as
"no redstone feed configured" and falls back to Pyth-only routing in
`getMid()`. For EURC + USDC the slot is read from the manifest; for any
other token the slot is derived on the fly via the standard mapping-key
formula.

```ts
import { disableRedstone } from "./anvil-helpers/oracle-cheats";
await disableRedstone({ rpcUrl, token: EURC_ADDRESS });
```

Both helpers write via `anvil_setStorageAt`, then re-read via
`eth_getStorageAt` and throw if the bytes don't match. See
`anvil-helpers/oracle-cheats.README.md` for the long-form rationale.

### F5c — `perps-fixtures.ts` `forceLiquidatable`

**Orchestrator wrapping the F5b cheats into a single liquidation-prep call.**

```ts
import { forceLiquidatable } from "./perps-fixtures";
await forceLiquidatable({ marketId, trader });
```

Does three things:

1. `widenOracleAgeLimit(3600n)` — relax freshness gate
2. `disableRedstone(EURC)` + `disableRedstone(USDC)` — force Pyth-only routing
3. `mineBlocks(1)` — surface the new oracle state

#### Current limitation — load-bearing

`forceLiquidatable` only normalises oracle-side preconditions. It does
**NOT** push a trader's health factor into the danger band. Driving HF
across the liquidation threshold needs a synthetic Pyth price write, which
needs `setPythPrice`, which is gated on F5d (see next section). The three
liquidation tests that depend on HF movement
(`pill-turns-danger`, `rescind CTA`, `liquidator-event`) therefore remain
`test.fixme()` with explicit F5d TODOs in `perps-liquidation.spec.ts`.

The `marketId` + `trader` args are kept in the signature for API stability
— callers don't have to change call sites when F5d lands.

### F5d (deferred) — `setPythPrice` + price-driven liquidation tests

The unblock for the three remaining liquidation tests. Requires:

1. A Pyth-specific storage survey analogous to F5a, against the
   `PythUpgradable` proxy at `0x2880aB155794e7179c9eE2e38200202908C17B43`.
   Pyth packs its `PriceFeed` struct across multiple slots and the
   base-mapping slot inside the proxy depends on the upgrade history — a
   `forge inspect`-grade bytecode walk is required.
2. Emit `pyth-slots.json` analogous to `oracle-slots.json`.
3. Add `setPythPrice` to `oracle-cheats.ts` consuming that manifest.
4. Un-fixme `pill-turns-danger`, `rescind CTA`, and `liquidator-event` in
   `perps-liquidation.spec.ts`.

Until then, `SET_PYTH_PRICE_DEFERRED` is exported as a sentinel from
`oracle-cheats.ts`.

## Note on PR #50 (Wave B liquidation UI)

The flag-delay-countdown test was a candidate for un-fixme in F5c (only
needs `evm_setNextBlockTimestamp` + `evm_mine`, both shipped). It stays
fixmed because the **flag-delay countdown UI itself** — `[data-flag-delay]`
or equivalent — is part of Wave B / PR #50 and is not on this base
branch. There is no DOM element to assert against. When PR #50 lands the
test body can drop in directly using the wrapper sample in the test file.

## Per-file map

- `fixtures.ts` — alpha-cookie + `gotoIsland` shared with arcade/loan tests
- `perps-fixtures.ts` — Trade-tab driver helpers + `forceLiquidatable`
- `anvil-helpers.ts` — `anvil_*` / `evm_*` RPC wrappers
- `anvil-helpers/oracle-slot-survey.ts` — F5a survey script
- `anvil-helpers/oracle-slots.json` — F5a manifest output
- `anvil-helpers/oracle-cheats.ts` — F5b storage-rewrite helpers
- `anvil-helpers/oracle-cheats.README.md` — F5b long-form docs
- `perps-open-close.spec.ts` — round-trip spec (Wave E2, mostly fixmed)
- `perps-liquidation.spec.ts` — liquidation spec (Wave E2, all fixmed pending F5d + PR #50)

## Running

```bash
# Full e2e (no fork)
bun run --filter ./apps/web playwright test

# Forked Anvil + perp suite
PERPS_E2E_FORK_ARC=1 bun run --filter ./apps/web playwright test

# List active (non-fixmed) tests only
bun run --filter ./apps/web playwright test --list
```
