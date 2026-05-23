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

```bash
# From this directory:
cargo check --workspace
cargo build --release --workspace
cargo test --workspace            # 86 active + 2 ignored
cargo clippy --all-targets -- -D warnings
```

`tonic-build` needs a `protoc` binary on PATH. On macOS: `brew install protobuf`.

Audit-prep proptest sweep (run before any mainnet sign-off):
```bash
PROPTEST_CASES=10000 cargo test -p bufi-orderbook --release
```

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
```

Boot:
```bash
cargo run --release -p bufi-matcher-server --bin bufi-matcher
```

The matcher will log both keeper + LP operator addresses on boot. Confirm
they match what's funded on Arc before submitting real intents.

## Coordinating with apps/api + frontend

The matcher polls `perp_order_intents` in the same SQLite DB the API
writes to. Make sure:

1. `apps/keeper-perps-matcher` (TS) is **NOT running** alongside — both
   processes would race to settle the same intent.
2. `apps/keeper-perps-funding` (TS) is **NOT running** alongside — the
   Rust matcher's `funding_poker` task replaces it.
3. `BUFI_DB_PATH` in `.env.local` for the matcher matches what the API
   resolves to (default `.bufi/trading-machine.sqlite` relative to the
   monorepo root).
4. `FX_TELARANA_DEPLOYMENTS` points at the live sprint-1 manifest
   (verified addresses in `~/coding-dojo/fx-telarana/docs/INTEGRATION_HANDOFF.md`).

The TS keeper `apps/keeper-perps-liquidator` is **separate** from the
matcher and should keep running — it's out of scope for this service.

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
