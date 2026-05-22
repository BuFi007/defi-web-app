# Matcher Architecture

**Status:** draft v1 — locked decisions, open implementation.
**Owner:** TBD (matcher lead).
**Audience:** anyone building, reviewing, or auditing the BUFI matching engine.
**Companion docs:**
- `docs/lp-backstop-design.md` (TODO — LP vault model, OI caps, fee splits)
- `docs/matcher-mainnet-readiness.md` (TODO — audit/invariant/golden gates)
- `INTEGRATION_ROADMAP.md` (existing — how the matcher fits into the system)

---

## North star

A standalone Rust service that owns the **off-chain order book** for every
BUFX perp market on Arc + Fuji. Takes signed intents in, emits matched fills
out. Pure, deterministic, replayable. The settlement layer (Solidity contracts
on Arc) is the source of truth for ownership; the matcher is the source of
truth for matching.

**Not** a frontend that calls contracts. **Not** a TS package that does
arithmetic. A dedicated service with a strict typed interface, runnable in
isolation, replayable from a fill log, and auditable line-by-line.

---

## Why a separate service (and why Rust)

| Concern | TS in `apps/api` | Rust in `services/matcher` |
|---|---|---|
| Throughput (orders/sec) | ~5-50k (BigInt-bound) | ~1-10M (native fixed-point) |
| Memory safety in 30-day uptime | GC pauses, leaks | ownership-checked, no GC |
| Auditor preference for safety-critical math | "why isn't this Rust?" | "good, what we expected" |
| Determinism across hosts | mostly fine (BigInt) | strictly enforceable (`no_std`-style core) |
| Crash isolation from API | shared event loop | separate process, restart independently |
| Fixed-point decimal libs | `decimal.js` (~10× slower) | `rust_decimal` (native) |
| Replayability from fill log | possible, but easy to break | easy if core is pure functions |

The matching engine is the hottest, most safety-critical, longest-lived
component in the stack. Putting it in TS alongside everything else means one
unbounded loop or memory leak in any other module takes the matcher down. A
separate process is non-negotiable; Rust is the canonical language choice for
that process — same shape Hyperliquid, Drift, and Vertex use.

This doc explicitly **does not** advocate rewriting everything in Rust. API
layer, indexer, web, keepers — those stay in TS. Only the matcher (and its
reconciler) move.

---

## Repo layout

```
services/matcher/                    ← Rust workspace root
├── Cargo.toml                        (workspace declaration)
├── Cargo.lock
├── README.md                         (build, test, run)
├── proto/
│   └── matcher.v1.proto              (gRPC contract — source of truth)
├── crates/
│   ├── orderbook/                    PURE — no IO, no time, no RNG
│   │   ├── src/
│   │   │   ├── lib.rs                (public API)
│   │   │   ├── book.rs               (OrderBook<M> struct, per-market)
│   │   │   ├── match_engine.rs       (match_intent core algorithm)
│   │   │   ├── price.rs              (Price as i64 fixed-point, NEVER f64)
│   │   │   ├── order.rs              (Order, Fill, Intent, IntentRef)
│   │   │   └── invariants.rs         (debug_assert! invariants)
│   │   └── tests/
│   │       ├── matching.rs           (price-time priority cases)
│   │       ├── properties.rs         (proptest invariants)
│   │       └── golden/               (replay fixtures)
│   ├── matcher-types/                shared types: serde, EIP-712 verify
│   │   ├── src/lib.rs
│   │   └── src/eip712.rs             (`alloy-sol-types` schemas)
│   ├── matcher-server/               BINARY — IO, async, tokio
│   │   ├── src/
│   │   │   ├── main.rs               (entry, config, tracing init)
│   │   │   ├── grpc.rs               (tonic service impl)
│   │   │   ├── redis_publisher.rs    (Redis pub/sub fan-out)
│   │   │   ├── intent_validator.rs   (EIP-712, nonce, expiry checks)
│   │   │   ├── lp_router.rs          (Phase 4 — LP fallback routing)
│   │   │   ├── funding.rs            (Phase 5 — funding rate engine)
│   │   │   └── mark_price.rs         (Phase 5 — oracle median + deviation gate)
│   │   ├── tests/
│   │   │   └── integration/
│   │   └── Cargo.toml
│   ├── matcher-reconciler/           BINARY — diffs matcher vs Ponder, alerts on drift
│   └── matcher-test-harness/         replay corpus, golden-file diff tool
└── deploy/
    ├── Dockerfile
    └── docker-compose.dev.yml         (matcher + redis + pyth-stub for local dev)
```

`services/` is already in the root `package.json` workspaces array — the
Cargo workspace lives next to TS services as a peer, not under them.

---

## Phase 2a amendment (2026-05-22) — wire format pinned to live contract

The Phase 0 reading produced a draft proto that assumed an abstract `Intent`
shape. Cross-referencing `fx-telarana/main` showed the deployed
`FxOrderSettlement` contract has a fixed `SignedOrder` typehash that the
matcher MUST produce bytes-for-bytes if signatures are to verify on-chain.
The proto + EIP-712 are now pinned to the contract. Drift findings + the
three locked decisions live in:

- `docs/matcher-reading-notes.md` §Source 4 + the 16-row drift table from
  the Phase 2a kickoff (commit history).
- The proto at `services/matcher/proto/matcher.v1.proto`.
- The EIP-712 mirror at `services/matcher/crates/matcher-types/src/eip712.rs`.
- The orderbook `Intent` type at
  `services/matcher/crates/orderbook/src/order.rs`.

**Locked decisions:**

1. **Wire format:** matcher's `SignedOrder` mirrors
   `FxOrderSettlement.SignedOrder` field-for-field. Fields 1-9 are
   EIP-712-hashed; fields 10+ (`signature`, `tif`, `client_tag`) are
   matcher-only and NOT in the typehash.
2. **Integration shape (Phase 3):** the Rust matcher replaces
   `apps/keeper-perps-matcher` outright — owns DB polling, EIP-712
   verification, matching, on-chain `settleMatch` calls (via `alloy-rs`),
   replacement-needed events.
3. **OI gating:** defence in depth — matcher gates an intent before
   accepting it (read-side query to `FxPerpClearinghouse`); contract is the
   backstop via `OpenInterestCapExceeded` / `SkewCapExceeded` reverts.

**Type widenings from spec original:**

- `Price` was `i64`, now `i128`. FX rates at E18 fit in `i64` individually
  (EUR/USD ≈ 1.08e18 < `i64::MAX ≈ 9.22e18`) but `price * size` products
  blow `i64`. `i128` is the smallest type that holds them with headroom
  and costs nothing on aarch64.
- `Size` decimals: 6 (USDC quantums) → 18 (matches `sizeDeltaE18` E18).
- `Side` is derived from the sign of `sizeDeltaE18` at the validator
  boundary; the orderbook still works with `Side::Long | Side::Short` +
  unsigned `magnitude` (`u128` E18).

**Nonce model swap:**

- Spec original: per-account monotonic `u64` nonce + a recent-nonce set.
- Contract truth (Permit2-style): `nonceBitmap[trader][nonce >> 8]`,
  bit `(nonce & 0xff)`. Nonces are NOT monotonic; up to 256 may coexist
  per word; collisions revert with `NonceAlreadyUsed`. Matcher-side
  validator must mirror this exact semantic.

**Time unit swap:**

- Spec original: `expires_at_ms` (unix milliseconds).
- Contract truth: `deadline` in unix **seconds** (matches `block.timestamp`).
  Field renamed `deadline_secs` throughout.

**Self-trade prevention:**

- Spec deferred STP to Phase 5+.
- Contract enforces `maker.trader != taker.trader` at
  `FxOrderSettlement.sol:78`. Matcher SHOULD still filter (avoid wasted
  txs) but the contract is the backstop.

**On-chain OI cap (LP invariant 1):**

- Already enforced on-chain via
  `FxPerpClearinghouse._marketConfig.maxOpenInterestUsd` +
  `openInterestLong/Short` per market. Matcher-side gate is now defence in
  depth, not the only guard.

**Market ids (Arc Testnet, chainId 5_042_002):**

Source of truth: `fx-telarana/deployments/perps-config-5042002.json` at
HEAD `c0ff0d3` (sprint-1 broadcast 2026-05-21).

| Symbol | Perp market id | On-chain status |
|---|---|---|
| EURC/USDC | `0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8` | listed |
| CIRBTC/USDC | `0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a` | listed |
| TJPYC/USDC | `0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab` | listed (NEW sprint-1) |
| TMXNB/USDC | `0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3` | listed (NEW sprint-1) |
| TCHFC/USDC | `0x992a2a93cd7a43a9ca827907f708a00ef88e9757e8aadab780ec4f58b161c7dd` | **unlisted on-chain**, kept in JSON — `marketConfig(id)` will revert. Filter on the on-chain enable state before consuming. |

**Earlier versions of this doc quoted the Morpho lending market ids
(`0x7d99…` / `0x1700…`) by mistake — those are from the SPOT money-market
stack via `FxMarketRegistry`, not the PERP stack via
`FxPerpClearinghouse._marketConfig`.**

The matcher loads these via `bufi-perps-onchain::MarketConfigSet` from
`fx-telarana/deployments/perps-config-{chainId}.json`. Fuji perp ids will
land in the same file when those markets deploy.

**Sprint-1 addresses (Arc Testnet, broadcast 2026-05-21 — supersede prior):**

| Contract | Address |
|---|---|
| `FxOrderSettlement` | `0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC` |
| `FxPerpClearinghouse` | `0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A` |
| `FxMarginAccount` | `0x4EB6018F988301417B93cb2b8899D74D42273e96` |
| `FxFundingEngine` | `0x859bA11A3693895f8B03C31C6AE3b8F04992115B` |
| `FxHealthChecker` | `0xA00Be167609c02F3879138dA8530BC31527c02b8` |
| `FxLiquidationEngine` | `0xF579e265EF1D5E67EfDbb1F20863465E94a9d3eA` |
| `FxOracle` | `0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78` |

Deployer / keeper EOA: `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` — flagged
for rotation per `fx-telarana/docs/INTEGRATION_HANDOFF.md` §Security note;
non-blocking for testnet development.

The matcher loader prefers `perp-stack-{chainId}.json` (sprint-1 file),
falling back to the legacy `perps-{chainId}.json` only when the new file
is absent. The fallback exists so the loader keeps working in dev
environments that haven't synced the latest fx-telarana clone.

**Reference TS signing recipe** for the secp256k1 EIP-712 path is in
`fx-telarana/packages/sdk/scripts/perp-arc-trading-smoke.ts`:

- `signOrder(account, signedOrder)` at **lines 472-490** — the actual
  `account.signTypedData(...)` call with the `TelaranaFxOrderSettlement`
  domain (line 475).
- Lines 215-260 are the *call site* of `settleMatch`, NOT the signing —
  the integration-handoff doc references this range but the recipe to
  port to Rust is the function at 472-490.

---

## The interface — gRPC via tonic

**Decision: gRPC, not REST.**

Reasoning:
- Bidirectional streaming for book diffs and trade tape; REST + polling is the
  wrong shape at the order rate this needs to handle.
- Protobuf is strict-typed end-to-end. Matches the "typed trading system"
  framing. Drift between TS and Rust types is a build-time error, not a
  runtime surprise.
- `tonic` is the Rust gRPC standard; `@connectrpc/connect-es` or `@grpc/grpc-js`
  on the TS side. Both produce types from the same `.proto`.

**Source of truth: `services/matcher/proto/matcher.v1.proto`.** Both languages
code-gen from it. Schema changes require updating the proto first; no TS-side
or Rust-side type can diverge.

### Service definition (v1)

> The sketch below is the *summary*. The canonical, machine-checked proto
> lives at `services/matcher/proto/matcher.v1.proto`. The amendments captured
> during Phase 0 reading (`docs/matcher-reading-notes.md` §Source 2, rows 1-7)
> are already applied to the canonical file. Diffs against this summary may
> exist while the spec catches up.

```protobuf
syntax = "proto3";
package matcher.v1;

service Matcher {
  // POST a signed intent. Returns synchronously with match outcome.
  // Caller is the API layer; user-facing latency budget is < 200ms.
  rpc SubmitIntent(SignedIntent) returns (MatchResult);

  // Cancel a resting order by intent id. Idempotent.
  rpc CancelIntent(IntentRef) returns (CancelResult);

  // Snapshot the current book for a market. Used by Web on connect,
  // before subscribing to diffs.
  rpc GetBook(MarketRef) returns (BookSnapshot);

  // Streaming book updates (snapshot + diff stream). Server pushes.
  rpc StreamBook(BookSubscription) returns (stream BookUpdate);

  // Streaming trade tape (every fill, for all subscribed markets).
  rpc StreamTrades(TradeSubscription) returns (stream Trade);

  // Health check, returns matching-engine state + last-fill timestamp.
  rpc Health(HealthRequest) returns (HealthResponse);
}

message SignedIntent {
  // bytes32 marketId (matches Solidity FxMarketRegistry id)
  bytes market_id = 1;
  // long | short
  Side side = 2;
  // limit | market — IOC + FOK are derived from time_in_force
  OrderType order_type = 3;
  // 6-decimal fixed-point quote-asset units (USDC). u128 over the wire.
  bytes size = 4;
  // 18-decimal WAD for price. NEVER serialize as double.
  bytes limit_price = 5;
  // GTC | IOC | FOK
  TimeInForce tif = 6;
  // Unique per-trader nonce, monotonic, replay-protection.
  uint64 nonce = 7;
  // Unix ms expiry. Matcher rejects past expiry.
  uint64 expires_at_ms = 8;
  // The signer (recovered from signature must match this).
  bytes account = 9;
  // EIP-712 signature (65 bytes: r || s || v).
  bytes signature = 10;
  // Optional client-supplied tag, echoed back in fills (latency tracing).
  string client_tag = 11;
}

message MatchResult {
  IntentRef intent_ref = 1;
  repeated Fill fills = 2;          // Empty if rested on book without match
  MatchStatus status = 3;            // FILLED | PARTIAL | RESTING | REJECTED
  optional string reject_reason = 4;
}

message Fill {
  bytes fill_id = 1;                 // bytes32 fill identifier
  bytes maker_intent_id = 2;
  bytes taker_intent_id = 3;
  bytes market_id = 4;
  Side taker_side = 5;
  bytes price = 6;                   // 18-decimal WAD
  bytes size = 7;                    // 6-decimal USDC units
  uint64 timestamp_ms = 8;
  // Whether this fill counter-party is the LP vault (Phase 4)
  bool is_lp_fill = 9;
}

// ... (rest of message definitions in actual proto)
```

The `bytes` fields for numeric values are u128/u256 wire-format encodings —
prost handles them, and TS clients receive them as `Uint8Array` which the
API layer converts to `bigint` before serializing to JSON for the browser.
This is the only way to preserve precision across the boundary.

---

## Determinism contract (NON-NEGOTIABLE)

The matcher MUST satisfy these properties. Violating any of them invalidates
the audit and the goldens.

### 1. Pure-function-modeled core

`crates/orderbook/` does:
- ❌ NO IO (no file, no network, no Redis, no DB)
- ❌ NO time (no `SystemTime::now()`, no `Instant::now()`, no chrono)
- ❌ NO RNG (no `rand`, no `uuid::Uuid::new_v4()`)
- ❌ NO unsafe (no `unsafe` blocks, compile-time enforced)
- ❌ NO global mutable state
- ✅ Inputs in, outputs out. Side effects ONLY via explicit `OrderBookState`
  reference passed in.

`current_timestamp_ms`, `fill_id`, `match_seq_no` — all PASSED IN by the
matcher-server caller, not generated inside the orderbook crate.

The matcher-server crate is allowed to do IO. The orderbook crate is not.
The Cargo manifest enforces this — `orderbook/Cargo.toml` lists zero
async runtimes, zero IO crates.

```toml
# crates/orderbook/Cargo.toml — locked dependency surface
[dependencies]
rust_decimal = "1.36"
serde = { version = "1", features = ["derive"] }
thiserror = "1"
# That's it. No tokio. No redis. No reqwest. No chrono. No rand. No tracing.
```

### 2. Replayability

Given the same sequence of `(SignedIntent, current_timestamp_ms)` tuples,
the matcher produces byte-identical fills. Goldens at
`crates/orderbook/tests/golden/*.json` define input → output expectations.

Every match function takes `now_ms: u64` as a parameter. No reading the
system clock from inside matching logic. Ever.

### 3. No floats anywhere in matching

`f32` and `f64` are linted against in `orderbook` via Clippy:
```toml
# crates/orderbook/Cargo.toml
[lints.clippy]
float_arithmetic = "deny"
float_cmp = "deny"
```

`Price` is `i64` fixed-point (18 decimals scaled, like WAD). `Size` is
`u128` fixed-point (6 decimals for USDC). Anything that needs to express a
fractional ratio uses `rust_decimal::Decimal`.

### 4. Deterministic ordering

When multiple matches are possible (e.g. two orders at the same price level
arrived in the same nanosecond), the tiebreaker is the intent's `nonce`
+ `account` hash. NEVER iteration order of a HashMap (which is randomized
in modern Rust).

`BTreeMap` for price level indexing. `VecDeque` for FIFO at each level.
Both are deterministic.

---

## Matching algorithm — price-time priority with LP fallback

### Phase 2 (initial): pure CLOB

```rust
pub fn match_intent(
    book: &mut OrderBook,
    intent: Intent,
    now_ms: u64,
) -> MatchResult {
    let mut fills = Vec::new();
    let mut remaining = intent.size;

    // 1. Validate (already done at server boundary; defensive here)
    if intent.expires_at_ms <= now_ms {
        return MatchResult::rejected(intent.id, RejectReason::Expired);
    }

    // 2. Walk the opposite book side, best-price first
    let opposite_side = book.side_mut(intent.side.opposite());
    while remaining > 0 {
        let Some(best_level) = opposite_side.peek_best() else { break; };
        if !crosses(intent.limit_price, best_level.price, intent.side) {
            break;  // No more matchable resting orders
        }

        // 3. Pop the FIFO front at this price level
        let mut maker = opposite_side.pop_front_at(best_level.price);
        let fill_size = min(remaining, maker.remaining);

        fills.push(Fill {
            fill_id: derive_fill_id(intent.id, maker.id, now_ms),
            maker_intent_id: maker.id,
            taker_intent_id: intent.id,
            market_id: intent.market_id,
            taker_side: intent.side,
            price: maker.price,
            size: fill_size,
            timestamp_ms: now_ms,
            is_lp_fill: false,
        });

        remaining -= fill_size;
        maker.remaining -= fill_size;

        if maker.remaining > 0 {
            opposite_side.push_front_at(best_level.price, maker);
        }
    }

    // 4. Handle remaining (rest on book or reject per TIF)
    if remaining > 0 {
        match intent.tif {
            TimeInForce::IOC => { /* drop remaining */ }
            TimeInForce::FOK if !fills.is_empty() => {
                // FOK partial fail — unwind by re-inserting makers
                return rollback(fills, intent, book);
            }
            TimeInForce::GTC | TimeInForce::IOC => {
                book.side_mut(intent.side).insert(Order::from(intent, remaining), now_ms);
            }
            _ => {}
        }
    }

    MatchResult::new(intent.id, fills, status_from(remaining, intent.size))
}
```

### Phase 4 (LP backstop): hybrid CLOB + LP

After Phase 2 lands, add LP fallback. After the book walk completes with
`remaining > 0`, route the remainder to the LP vault if:
- LP is enabled for this market
- LP delta cap not exceeded
- LP OI cap not exceeded

```rust
// Pseudocode — actual implementation in crates/matcher-server/src/lp_router.rs
if remaining > 0 && lp_state.can_take(intent.side, remaining, mark_price) {
    let lp_price = mark_price + lp_spread_for_size(intent.side, remaining, lp_state);
    fills.push(Fill::from_lp(intent, lp_price, remaining, now_ms));
    lp_state.absorb(intent.side, remaining, lp_price);
    remaining = 0;
}
```

LP pricing, OI caps, and risk math are detailed in
`docs/lp-backstop-design.md` (to be written before Phase 4 starts).

---

## Critical invariants — tested

These are the invariants the test suite covers. Each maps to a failure mode
that, if exploitable, drains funds or breaks settlement integrity.

| # | Invariant | Failure if violated |
|---|---|---|
| 1 | An intent never fills more than its declared `size` | Double-fill → user pays for size they didn't request |
| 2 | At the same price level, earlier arrival fills first | Time priority manipulation → MEV attack on resting orders |
| 3 | `best_bid_price < best_ask_price` after every match | Crossed book → mark-price corruption |
| 4 | Σ fill_sizes for intent + remaining_on_book ≤ original_size | Conservation broken → fills > deposits possible |
| 5 | Replay determinism: same input sequence → byte-identical fills | Audit/golden tests meaningless |
| 6 | No fill with `price = 0` or `size = 0` | Divide-by-zero in PnL; ghost fills |
| 7 | Cancel of an intent that has already fully filled is a no-op (not an error) | Race condition between cancel + match → spurious errors |
| 8 | Expired intent never matches, even if it could otherwise cross | Clock manipulation → stale orders trade at stale prices |
| 9 | LP fill never exceeds LP available size cap | LP drainage by one whale trade |
| 10 | LP fill price ≥ mark_price + min_spread_for_size | LP eats adverse selection too cheaply |

Invariants 1-8 land in Phase 2. 9-10 land in Phase 4 with the LP backstop.

`proptest` randomizes intent sequences and asserts these hold for every
random run. `crates/orderbook/tests/properties.rs`.

---

## Integration with existing services

```
                                    ┌───────────────────────────────────┐
                                    │  Solidity contracts (Arc + Fuji)  │
                                    │  FxMarketRegistry, Morpho, etc.   │
                                    └─────────┬─────────────────────────┘
                                              │ events
                                              ▼
                                    ┌─────────────────────┐
                                    │  Ponder indexer     │
                                    │  apps/ponder        │
                                    │  (TS)               │
                                    └─────────┬───────────┘
                                              │ subscribes / writes
                                              ▼
┌──────────────────────┐  gRPC  ┌─────────────────────┐    Redis      ┌──────────────────────┐
│  apps/api (Hono/Bun) │ ─────▶ │ services/matcher    │ ────────────▶ │ apps/keeper-*         │
│  /perps/intent       │        │ (Rust binary)       │  pub fills    │ batches + settles     │
│  /perps/quote        │ ◀───── │                     │               │                       │
└──────────┬───────────┘  WS    └─────────┬───────────┘               └──────────┬───────────┘
           │                              │ Redis pub/sub                         │
           │                              ▼                                       │
           │                    ┌─────────────────────┐                          │ on-chain
           │                    │  Pyth Hermes WS     │                          │ settle tx
           │                    │  (mark price)       │                          │
           │                    └─────────────────────┘                          │
           ▼                                                                      ▼
┌──────────────────────┐                                              ┌──────────────────────┐
│  apps/web (Next.js)  │                                              │   Solidity contracts │
│  trade UI            │                                              │   (settlement)       │
└──────────────────────┘                                              └──────────────────────┘
```

### apps/api integration

`apps/api/src/lib/matcher-client.ts` (new) — gRPC client, holds a long-lived
connection. Generated from `proto/matcher.v1.proto` via `protoc-gen-connect-es`.

`apps/api/src/routes/perps.ts` — replace the existing intent handler:
```ts
// Before:
const result = await submitIntentToKeeper(intent);

// After:
const result = await matcher.submitIntent(intent);
if (result.fills.length > 0) {
  // matcher already published to Redis; keeper picks up the settlement
}
return c.json(result);
```

API layer remains the user-facing surface. Auth, rate limiting, request
validation, and response shaping stay in TS. The matcher is purely the
matching kernel.

### Keeper integration (Wave E6 — PR #56 land first)

Keepers subscribe to `matcher.fills.{marketId}` on Redis. For each fill:
1. Read the fill, look up the on-chain market + tokens
2. Batch with other fills in the same window (50ms or 10 fills, whichever first)
3. Build and submit the settlement transaction on Arc
4. On revert: re-emit fill to `matcher.fills.failed` for manual review

The keeper protocol is documented in `apps/keeper-*/README.md`. The matcher
doesn't know about chains; it only emits fills.

### Ponder integration

Ponder indexes the on-chain settled fill (post-settlement). The matcher's
record and Ponder's record must agree. Mismatch → reconciler alerts.

`services/matcher-reconciler/` — small Rust binary, runs every 60s:
```
matcher_fills_60s_ago = matcher.fills_since(now - 60s)
ponder_settlements_60s_ago = ponder.settlements_since(now - 60s)
mismatches = diff(matcher_fills_60s_ago, ponder_settlements_60s_ago)
if mismatches: emit OTel alert
```

### Web integration

Web subscribes to `Matcher.StreamBook` and `Matcher.StreamTrades` via WS
(through the API layer's reverse proxy — Web never talks to matcher directly).

Book updates flow: matcher → API WS → Web. Sub-100ms goal.

---

## Configuration & deployment

### Runtime config (env vars, validated at boot)

```
MATCHER_GRPC_PORT=50051
MATCHER_HTTP_PORT=8081               # health + metrics + admin
MATCHER_REDIS_URL=redis://...
MATCHER_LOG_LEVEL=info
MATCHER_OTEL_ENDPOINT=https://api.axiom.co/v1/traces
MATCHER_FILL_PERSISTENCE=/var/lib/matcher/fills.jsonl
MATCHER_BOOK_SNAPSHOT_INTERVAL_MS=5000
MATCHER_INTENT_EXPIRY_MAX_MS=3600000  # 1h max expiry
MATCHER_LP_ENABLED=false              # Phase 4 unlock
MATCHER_FUNDING_ENABLED=false         # Phase 5 unlock
```

### Persistence model

The matcher's order book is in-memory. On restart:
1. Read the latest book snapshot from Redis (snapshotted every 5s)
2. Replay all fills + new intents from the snapshot timestamp forward
3. State reconstructed before serving traffic

Fill log on disk (`MATCHER_FILL_PERSISTENCE`) is append-only JSONL.
Crash-safe via `fsync` per batch. Used for forensics and golden replay.

### Deployment

Single Rust binary, statically linked, distroless container. Health endpoint
on `:8081/health` returns `{ books: { ... per-market book depth ... },
last_fill_ms, uptime_s, version }`. Drains gracefully on SIGTERM.

Run two replicas in production (active-passive). Failover via Redis lease
on `matcher.leader.lock`. Only the leader writes; the passive follows the
Redis fill stream and warms its book state.

---

## Phasing

| Phase | Scope | Calendar weeks | Gates before next |
|---|---|---|---|
| 0 | All 22 PRs land on main | 1-2 | wk1d1 + #39 + #43 + #45 + #56 merged |
| 1 | Spec, proto, scaffolding | 2 | proto v1 frozen, codegen wired both sides |
| 2 | Core orderbook + matching (no LP) | 3 | invariants 1-8 tested, golden suite passing |
| 3 | TS integration (API + keeper + Ponder reconciler) | 2 | end-to-end intent → settled fill via matcher service |
| 4 | LP backstop | 4 | invariants 9-10 tested, LP vault audited |
| 5 | Funding rate + mark price safety | 2 | funding math goldens passing, deviation gate trips on stub oracle drop |
| 6 | Determinism + invariant suite hardening | ongoing | mainnet readiness doc signed off |

**Total estimated wall time:** ~14 weeks of focused work, single owner.
Plus 4-6 weeks for the LP vault contract audit before that contract touches
mainnet.

---

## What's explicitly NOT in v1

To prevent scope creep and to keep the spec small:

- ❌ **Cross-margin between perp markets.** v1 is isolated margin per market.
  Cross-margin requires margin engine work outside the matcher.
- ❌ **Spot ↔ perp arbitrage routing.** v1 matches only perp markets. Spot
  stays on Telarana/Morpho.
- ❌ **Self-trade prevention beyond same-intent.** Two intents from the same
  account CAN trade against each other in v1 (rare in practice; STP is a
  Phase 5+ add).
- ❌ **Iceberg orders, hidden sizes, post-only.** All orders are fully
  visible. Advanced order types land post-v1.
- ❌ **TWAP / VWAP execution algorithms.** These are client-side concerns
  built on top of the matcher.
- ❌ **Conditional orders (stop, stop-limit).** Trigger logic lives in the
  API layer, not the matcher.
- ❌ **Auction matching (call markets).** Continuous-only.
- ❌ **Multi-leg orders / spreads.** One market per intent.

Each of these has a follow-on doc when its time comes. Don't fight them
into v1.

---

## Open questions (need decisions before Phase 1 starts)

1. **Account model.** Does the matcher track per-account state (positions,
   margin) or is that purely the contract's job? Strawman: matcher tracks
   only orders, contract tracks positions, Ponder reconciles. Pro: minimal
   matcher state. Con: harder to enforce per-account OI caps off-chain.
2. **gRPC vs Connect.** `tonic` (full gRPC) or `tonic-web`/Connect (gRPC-Web)?
   Connect plays nicer with browser clients via the API proxy, but the API
   proxy can convert anyway. Recommendation: full gRPC for API↔matcher, REST
   for browser↔API.
3. **Fill ID derivation.** Deterministic hash of `(maker_intent_id,
   taker_intent_id, sequence_no)`? Includes `now_ms` for uniqueness across
   replays? Locks in goldens — pick once, don't change.
4. **Leader election.** Redis lease (simple) or Raft (overkill at this
   scale)? Recommendation: Redis lease with 5s renewal, 10s expiry. Document
   the split-brain window explicitly.
5. **Book snapshot format.** msgpack for size, JSON for debuggability?
   Recommendation: msgpack to Redis, JSON for disk-debug snapshots.

Each becomes a one-line decision in this doc once made. Don't ship Phase 1
without answering them.

---

## Reference implementations

All repos below are cloned (shallow, blobs filtered) into `references/` at
the repo root, gitignored. They exist on disk for direct grep/code-read,
not as runtime dependencies. Refresh with `git -C references/<name> pull`
or re-clone individually.

### Reading order before Phase 1

Total budget: ~1.5 days. Skip nothing — each item is on this list because
it answers a specific question you'll otherwise spend longer rediscovering.

| # | What to read | Time | Why this, why now |
|---|---|---|---|
| 1 | `references/Polymarket-ctf-exchange-v2` contracts + `references/Polymarket-rs-clob-client-v2` types | 1 day | The closest publicly-readable hybrid CLOB + LP design to what you're building. Polymarket's split of "match against book first, fall back to LP" is the same shape Synthra described in the interview — except Polymarket open-sourced their version. Read the Rust client types to understand the wire format choices for signed orders, then read the contracts to see how settlement closes the loop. |
| 2 | `references/dydxprotocol-v4-chain/proto/` + their streaming docs | 4 hr | The canonical gRPC + streaming pattern for a perp DEX. Read the proto files first (they're literally the API surface), then the streaming docs to see how they paginate book snapshots + push diffs. Copy the shape of `StreamBook` and `StreamTrades` from here verbatim — they've solved the cursor + reconnection edge cases you'd otherwise hit. |
| 3 | `references/joaquinbejar-OrderBook-rs` core matching loop | 2 hr | The smallest, cleanest Rust orderbook reference. Read `src/match_engine.rs` (or equivalent) to see a working price-time-priority loop in 200ish lines. Use as a structural template for `crates/orderbook/src/match_engine.rs`. Do NOT copy the data structures wholesale — you want fixed-point `Price` not floats. |
| 4 | JELLY attack writeup + Drift BAL docs (in `references/drift-labs-protocol-v2`) | 2 hr | **Before designing LP backstop.** The JELLY incident (Hyperliquid, March 2025) drained ~$13M from HLP via a manipulated thinly-traded market. Drift's Backstop Anchor Liquidity (BAL) design includes the per-market OI caps, dynamic LP exposure limits, and oracle-deviation circuit breakers Hyperliquid lacked. Read this before sketching the LP routing logic in Phase 4 — every safeguard in this writeup must appear in `docs/lp-backstop-design.md`. |

### Prediction-market CLOB (hybrid book + LP)

| Repo | Purpose |
|---|---|
| [Polymarket/ctf-exchange-v2](https://github.com/Polymarket/ctf-exchange-v2) | Conditional Token Framework CLOB v2 — current production contracts. Closest analog to BUFI's hybrid model. |
| [Polymarket/ctf-exchange](https://github.com/Polymarket/ctf-exchange) | CLOB v1 — historical reference, simpler design, easier to read first if v2 feels dense. |
| [Polymarket/rs-clob-client-v2](https://github.com/Polymarket/rs-clob-client-v2) | Rust client types. Read for wire format + signed-order encoding patterns. |
| [ahollic/polymarket-architecture](https://github.com/ahollic/polymarket-architecture) | Third-party architecture writeup, useful overview before diving into source. |
| [KaustubhPatange/polymarket-trade-engine](https://github.com/KaustubhPatange/polymarket-trade-engine) | Reimplementation / educational engine. Cross-reference patterns. |

### Perp DEX CLOB + gRPC streaming patterns

| Repo | Purpose |
|---|---|
| [dydxprotocol/v4-chain](https://github.com/dydxprotocol/v4-chain) | The canonical perp DEX with open-source matching. Go, not Rust, but the algorithms + proto definitions translate directly. **Read `proto/` first.** |
| [drift-labs/protocol-v2](https://github.com/drift-labs/protocol-v2) | Solana perp protocol. Rust matching, BAL (LP backstop) design, insurance fund. Read after Polymarket. |
| [drift-labs/drift-rs](https://github.com/drift-labs/drift-rs) | Rust client SDK. Useful for understanding how their client encodes orders + reads book snapshots. |
| [drift-labs/gateway](https://github.com/drift-labs/gateway) | Their gRPC gateway — analogous to what `apps/api/src/lib/matcher-client.ts` will do on BUFI's side. |
| [drift-labs/keep-rs](https://github.com/drift-labs/keep-rs) | Rust keeper for settling matched fills on-chain. Closest model for your `apps/keeper-*` integration. |

### LP backstop / vault references

| Repo | Purpose |
|---|---|
| [drift-labs/protocol-v2](https://github.com/drift-labs/protocol-v2) | BAL (Backstop Anchor Liquidity) + insurance fund. The post-JELLY safer alternative to Hyperliquid HLP. **Required reading before Phase 4.** |
| [gmx-io/gmx-contracts](https://github.com/gmx-io/gmx-contracts) | GLP on Arbitrum (older, simpler). LP-as-counterparty pattern, single asset. |
| [gmx-io/gmx-synthetics](https://github.com/gmx-io/gmx-synthetics) | GMX v2 — newer, modular, per-market isolated pools. The architecture BUFI should mirror for FX markets (each pair = isolated LP). |
| [Fkleppe/awesome-perp-trading](https://github.com/Fkleppe/awesome-perp-trading) | Curated survey of perp/LP mechanism designs. Use as a table of contents, not a primary read. |

### Rust orderbook skeletons (data structures only)

These are reference implementations of the *data structures and matching
loop*, not full trading systems. Read for structural patterns; do NOT
adopt wholesale — most use `f64` prices, which BUFI's spec forbids.

| Repo | Purpose |
|---|---|
| [joaquinbejar/OrderBook-rs](https://github.com/joaquinbejar/OrderBook-rs) | Smallest clean Rust orderbook. Best starting point. |
| [auralshin/orderbook](https://github.com/auralshin/orderbook) | Alternative structure, useful for cross-checking design choices. |
| [dylanlott/orderflow](https://github.com/dylanlott/orderflow) | More feature-complete; read after the simpler ones. |
| [hroptatyr/clob](https://github.com/hroptatyr/clob) | C, not Rust, but the matching loop is exceptionally clean. Worth 30 minutes for the algorithmic clarity. |

### Crate / tooling references

| Repo | Purpose |
|---|---|
| [hyperium/tonic](https://github.com/hyperium/tonic) | gRPC server + client. Read the `streaming` example specifically — copy the shape of `StreamBook` from there. |
| [paupino/rust-decimal](https://github.com/paupino/rust-decimal) | Fixed-point decimal math, the chosen `Price` representation. Read the perf notes to understand why this crate over `bigdecimal` (10× faster, smaller surface, safer overflow semantics). |

---

## Sign-off

This doc is the source of truth for the matcher service. Any deviation in
implementation must update this doc in the same PR. Anyone reviewing matcher
code starts here.

Next docs to write:

1. `docs/lp-backstop-design.md` — before Phase 4 starts.
2. `docs/matcher-mainnet-readiness.md` — before any matcher code touches a
   production mainnet contract.
3. `services/matcher/README.md` — practical build/test/run, written
   alongside Phase 1 scaffolding.
