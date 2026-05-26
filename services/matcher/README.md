# BUFI matcher service

Standalone Rust matching engine for the BUFX perp DEX on Arc Testnet
(5042002) + Avalanche Fuji (43113). Pure-core orderbook in `crates/orderbook/`,
tokio orchestration binary in `crates/matcher-server/`, plus the on-chain
client, DB layer, and reconciler.

## Status

**Phases 0–7 shipped** (PR #107). Replaces `apps/keeper-perps-matcher` and
`apps/keeper-perps-funding`. 86 active tests + 2 ignored live-Arc smoke
tests. Clippy clean under `-D warnings`. See `docs/matcher-architecture.md`
for the spec + phase amendments and `docs/matcher-mainnet-readiness.md`
for the mainnet sign-off gate.

## Layout

```
services/matcher/
├── Cargo.toml                          workspace declaration
├── rust-toolchain.toml                 pins Rust 1.93
├── proto/matcher.v1.proto              gRPC wire format
└── crates/
    ├── orderbook/                      PURE core. No IO. No floats. No clock.
    ├── matcher-types/                  EIP-712 schemas (TelaranaFxOrderSettlement)
    ├── perps-db/                       sqlx-SQLite, mirrors @bufi/db
    ├── perps-onchain/                  alloy-rs bindings + JSON loaders
    ├── matcher-server/                 tokio orchestrator binary
    ├── matcher-reconciler/             (Phase 8+) diffs matcher fills vs Ponder
    └── matcher-test-harness/           golden replay tool
```

## Building & testing

From the monorepo root (uses the `@bufi/matcher` workspace shim):

```bash
bun run matcher:build              # release build of the matcher binary
bun run matcher:test               # 86 active + 2 ignored
bun run matcher:clippy             # all-targets, -D warnings
bun run matcher:test:audit-prep    # PROPTEST_CASES=10000 (before mainnet sign-off)
```

From inside `services/matcher/` (direct cargo):

```bash
cargo check --workspace
cargo build --release --workspace
cargo test --workspace
cargo clippy --all-targets -- -D warnings
```

`tonic-build` needs a `protoc` binary on PATH. On macOS: `brew install protobuf`.

## Running against Arc Testnet

Three signing EOAs, all distinct (boot fails fast on collision):

| Role | Env var | Purpose | Required? |
|---|---|---|---|
| Keeper | `PERP_KEEPER_PRIVATE_KEY` (or `DEPLOYER_PRIVATE_KEY` fallback) | Signs `settleMatch` txs | YES |
| LP operator | `LP_OPERATOR_PRIVATE_KEY` | Signs synthetic LP SignedOrders | optional (disables LP backstop if unset) |
| Canary trader | `CANARY_TRADER_PRIVATE_KEY` | Liveness probe | optional (disables canary if unset) |

Minimum `.env.local` for Arc Testnet:

```bash
# --- DB (shared with apps/api) ---
BUFI_DB_PATH=/Users/<you>/coding-dojo/defi-web-app/.bufi/trading-machine.sqlite

# --- Deployment manifest source ---
FX_TELARANA_DEPLOYMENTS=/Users/<you>/coding-dojo/fx-telarana/deployments

# --- Chain + RPC ---
MATCHER_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network

# --- Keys (3 distinct EOAs!) ---
PERP_KEEPER_PRIVATE_KEY=0x...   # SETTLER_ROLE on FxOrderSettlement
LP_OPERATOR_PRIVATE_KEY=0x...   # margin pre-funded for LP backstop
CANARY_TRADER_PRIVATE_KEY=0x... # margin pre-funded for liveness probe

# --- Optional tunables (defaults shown) ---
MATCHER_TICK_BUSY_MS=1000
MATCHER_TICK_IDLE_MS=30000
MATCHER_EVENT_POLL_MS=5000
MATCHER_EVENT_CONFIRMATIONS=3
FUNDING_POKE_MIN_INTERVAL_MS=3600000
CANARY_INTERVAL_SECS=1800
CANARY_TIMEOUT_SECS=120
CANARY_NOTIONAL_USDC_E6=1000000

# --- Perps liquidator (optional, Hookathon Phase 6) ---
LIQUIDATOR_ENABLED=true
LIQUIDATOR_ENVIO_URL=https://indexer.envio.dev/bufx-yield-engine/graphql
LIQUIDATOR_CHECK_INTERVAL_MS=1000
LIQUIDATION_ROUTER_ADDRESS=0x6349658AB89bB13a608b50835230d4b85Eb4734f
```

Boot (three options, ordered most-integrated to most-direct):

```bash
# 1. Full stack — matcher + web + api + ponder + TS keepers together.
#    `.env.local` at the monorepo root is auto-loaded by bun.
bun run dev:complete

# 2. Matcher only, via the workspace shim. Reads `.env.local` from the
#    monorepo root that bun sources for every workspace subprocess.
bun run matcher:dev

# 3. Direct cargo invocation. Source `.env.local` yourself first.
cd services/matcher
set -a && source ../../.env.local && set +a
cargo run --release -p bufi-matcher-server --bin bufi-matcher
```

The matcher will log both keeper + LP operator addresses on boot. Confirm
they match what's funded on Arc before submitting real intents.

### Env-var name resolution

The matcher honours both the canonical names and the names already in
the monorepo's `.env.local`, so a fresh `bun run dev:complete` works
without renaming. Resolution order (first hit wins):

| Matcher field | Env var precedence |
|---|---|
| Keeper signer | `PERP_KEEPER_PRIVATE_KEY` → `KEEPER_PRIVATE_KEY` → `DEPLOYER_PRIVATE_KEY` |
| LP operator | `LP_OPERATOR_PRIVATE_KEY` (optional — disables LP backstop if unset) |
| Canary trader | `CANARY_TRADER_PRIVATE_KEY` (optional — disables canary if unset) |
| DB path | `BUFI_DB_PATH` → `TRADING_MACHINE_DB_PATH` → `.bufi/trading-machine.sqlite` |
| Deployments | `FX_TELARANA_DEPLOYMENTS` → `../../fx-telarana/deployments` relative to cwd |
| RPC | `ARC_RPC_URL` → `https://rpc.testnet.arc.network` |

## Coordinating with apps/api + frontend

The matcher polls `perp_order_intents` in the same SQLite DB the API
writes to. Make sure:

1. `apps/keeper-perps-matcher` (TS) is **NOT running** alongside — both
   processes would race to settle the same intent.
2. `apps/keeper-perps-funding` (TS) is **NOT running** alongside — the
   Rust matcher's `funding_poker` task replaces it.
3. **`BUFI_DB_PATH` must point at the same file from BOTH apps/api and
   the matcher.** The default `.bufi/trading-machine.sqlite` is
   resolved relative to each process's working directory, which means
   if you launch `apps/api` from `apps/api/` and the matcher from
   `services/matcher/`, they'll silently create two DIFFERENT
   `.bufi/trading-machine.sqlite` files and nothing will work. Set
   `BUFI_DB_PATH` to an absolute path in `.env.local` at the monorepo
   root and `bun run dev:complete` will pass it to every workspace.
4. `FX_TELARANA_DEPLOYMENTS` points at the live sprint-1 manifest
   (verified addresses in `~/coding-dojo/fx-telarana/docs/INTEGRATION_HANDOFF.md`).

The Rust perps liquidator is part of the matcher binary. Enable it with
`LIQUIDATOR_ENABLED=true`; it reads open positions from Envio and uses the
shared Pyth WS stream for event-driven scans.

### Live intent status (Step 3, 2026-05-23)

The API ships an SSE endpoint at `GET /perps/intents/:id/stream` that
the Trade UI's `useIntentStatusStream` hook subscribes to after a user
submits an intent. The matcher's existing `record_fill` + status
updates land in `perp_order_intents.status`, the API SSE handler polls
that row every 1s and pushes a `status` event on change, and the UI
shows a live `pending → partially_filled → settled` pill in the Trade
panel. No new matcher code — the matcher's existing tick-loop writes
ARE the upstream signal.

## Determinism contract

`crates/orderbook/` MUST NOT depend on tokio, reqwest, chrono, or rand.
`Cargo.toml` enforces this; `clippy.toml` blocks `SystemTime::now`,
`Instant::now`, `HashMap`, and `HashSet` use. Anything that needs the
outside world goes in `matcher-server/`. The pure-core boundary is the
audit surface — see `crates/orderbook/src/lp_gate.rs::pure_check` for the
LP-backstop equivalent.

## Companion docs

- [`docs/matcher-architecture.md`](../../docs/matcher-architecture.md) — spec + phase 2a/3c/4/5/6/7 amendments
- [`docs/lp-backstop-design.md`](../../docs/lp-backstop-design.md) — JELLY post-mortem walkthrough + 12 invariants
- [`docs/matcher-mainnet-readiness.md`](../../docs/matcher-mainnet-readiness.md) — sign-off gate (22 ⬜ rows tracked)
- [`docs/matcher-integration-runbook.md`](../../docs/matcher-integration-runbook.md) — end-to-end smoke against Arc Testnet

## /rust-matcher skill

The `services/matcher/skills/rust-matcher/SKILL.md` file is the master
prompt for anything that touches this service. Symlink it into your local
`.claude/skills/` so the runtime picks it up:

```bash
mkdir -p .claude/skills
ln -s ../../services/matcher/skills/rust-matcher .claude/skills/rust-matcher
```
