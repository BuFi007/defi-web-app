# BUFI matcher service

Standalone Rust matching engine for the BUFX perp DEX. Pure-core orderbook
in `crates/orderbook/`, gRPC server in `crates/matcher-server/`, plus a
reconciler and replay test harness.

## Status

**Phase 1 — scaffold only.** No matching logic yet. `cargo check` passes;
binaries boot, log, and exit cleanly. See
`docs/matcher-architecture.md` §Phasing for what lands when.

## Layout

```
services/matcher/
├── Cargo.toml                          workspace declaration
├── rust-toolchain.toml                 pins Rust 1.93
├── proto/
│   └── matcher.v1.proto                gRPC wire format — source of truth
├── crates/
│   ├── orderbook/                      PURE core. No IO. No floats. No clock.
│   ├── matcher-types/                  prost-generated types + EIP-712 schemas
│   ├── matcher-server/                 gRPC binary
│   ├── matcher-reconciler/             diffs matcher fills vs Ponder
│   └── matcher-test-harness/           golden replay tool
└── deploy/
    └── Dockerfile                      distroless build (placeholder)
```

## Building

```bash
# From the workspace root:
cd services/matcher
cargo check --workspace
cargo build --release --workspace
cargo test --workspace
```

`tonic-build` needs a `protoc` binary on PATH. On macOS: `brew install protobuf`.

## Determinism contract

`crates/orderbook/` MUST NOT depend on tokio, redis, reqwest, chrono, or
rand. The crate's `Cargo.toml` enforces this; the `clippy.toml` blocks
`SystemTime::now`, `Instant::now`, `HashMap`, and `HashSet` use. Anything
that needs the outside world goes in `matcher-server/`.

Goldens live at `crates/orderbook/tests/golden/*.json` (empty in Phase 1,
populated in Phase 2). A run of `bufi-matcher-replay` against the corpus is
required to be byte-identical between hosts.

## Companion docs

- [`docs/matcher-architecture.md`](../../docs/matcher-architecture.md) — spec
- [`docs/matcher-reading-notes.md`](../../docs/matcher-reading-notes.md) — Phase 0 reference findings
- `docs/lp-backstop-design.md` — TODO, written before Phase 4 starts
- `docs/matcher-mainnet-readiness.md` — TODO, written before any mainnet touch
