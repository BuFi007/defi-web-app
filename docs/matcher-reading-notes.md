# Matcher Reading Notes — Phase 0 Reference Pass

**Status:** captured 2026-05-21, before any scaffold code lands.
**Owner:** matcher lead (TBD).
**Audience:** anyone about to touch `services/matcher/`.
**Companion:** `docs/matcher-architecture.md` (spec) — this doc records what we
learned from the reference repos that should now amend the spec.

The four sources cover:

1. **Polymarket** `ctf-exchange-v2` + `rs-clob-client-v2` — hybrid CLOB shape,
   EIP-712 wire format, settlement loop.
2. **dYdX v4** `proto/` — gRPC service surface, streaming book diffs, numeric
   encoding, cancellation idempotency.
3. **joaquinbejar/OrderBook-rs** `src/` — pure-Rust price-time-priority match
   loop pattern.
4. **Drift v2 + JELLY incident** — LP backstop attack surface and concrete
   safeguards a post-JELLY design must implement.

All four are mirrored under `references/`. File-path citations in this doc
are relative to the repo root.

---

## Bottom-line — decisions amended into the spec

| # | Decision | Source | Touches |
|---|---|---|---|
| 1 | Freeze `proto/matcher.v1.proto` with `snapshot:bool` semantics on `BookUpdate`, per-market `sequence_number`, and explicit `HealthResponse{match_sequence_number,last_fill_timestamp_ms}` | dYdX | `proto/`, `matcher-architecture.md` §gRPC |
| 2 | `CancelResult` returns `CancelStatus{CANCELED, NOT_FOUND, ALREADY_FILLED}` + `residual_size` — idempotent, semantics-rich | dYdX + Polymarket | `proto/` |
| 3 | Wire numerics: `bytes` (u256-encoded) for `size`/`price`, `uint64` for `nonce`/`expires_at_ms`/`timestamp_ms`/`sequence_number`. NEVER `double`/`float`. | dYdX | `proto/` |
| 4 | EIP-712 domain: `BUFI Matcher`, `version "1"`, `chainId` per env. Order struct mirrors Polymarket v2 layout but uses our nonce model. Verify via `alloy-sol-types` with EOA + EIP-1271 dispatch | Polymarket | `crates/matcher-types/src/eip712.rs` |
| 5 | Replay protection: per-account monotonic `nonce` (NOT salt-only — Polymarket trusts its operator; we don't yet) + `expires_at_ms` + matcher-side `Set<(account, nonce)>` window | Polymarket + own design | `crates/matcher-server/src/intent_validator.rs` |
| 6 | Orderbook side storage: `BTreeMap<Price, VecDeque<Order>>` per side, `Price` as `i64` fixed-point (18-decimal WAD). Match loop driven by a `StopCondition` enum (BaseQty vs QuoteAmount) per joaquinbejar's pattern. | joaquinbejar | `crates/orderbook/src/book.rs`, `match_engine.rs` |
| 7 | FOK uses non-mutating `peek_match()` before any state mutation — eliminates rollback complexity | joaquinbejar | `crates/orderbook/src/match_engine.rs` |
| 8 | `docs/lp-backstop-design.md` MUST encode 12 invariants from the Drift/JELLY pass (table in §LP below) before any Phase 4 code | Drift v2 | new doc |
| 9 | LP fill emits `Fill{is_lp_fill: true}` on the same wire path as CLOB fills — reconciler diffs LP fill count + notional against `lp_state.position_delta` | Drift v2 | `crates/matcher-server/src/lp_router.rs` |
| 10 | Settlement model: **per-fill on-chain settlement** (Polymarket's `matchOrders` shape) — NOT batched netting. Keeper-driven on Arc, one tx per fill in v1, batched windowing as a v1.x optimisation. | Polymarket | `apps/keeper-*`, `INTEGRATION_ROADMAP.md` |
| 11 | Operator role: the matcher is the trusted operator of its book (Polymarket model). Cancellation is off-chain only; the API instructs the matcher; nothing hits chain on cancel. | Polymarket | `matcher-architecture.md` §Cancellation |
| 12 | Self-trade prevention: deferred. v1 ships without STP; track as Phase 5+ work. Polymarket has none either. | Polymarket | spec §What's NOT in v1 |

These rows are the diff to apply to `docs/matcher-architecture.md` and to
`proto/matcher.v1.proto` once the scaffold lands.

---

## Source 1: Polymarket (`ctf-exchange-v2` + `rs-clob-client-v2`)

### Wire format

`OrderV2` Solidity struct (`references/Polymarket-ctf-exchange-v2/src/exchange/libraries/Structs.sol:25-89`):

```solidity
struct Order {
  uint256 salt;
  address maker;
  address signer;            // can differ from maker (delegate signing)
  uint256 tokenId;           // CTF position id — N/A for BUFX, replace with marketId
  uint256 makerAmount;
  uint256 takerAmount;
  uint8 side;                // 0=BUY, 1=SELL
  uint8 signatureType;       // 0=EOA, 1=Proxy, 2=Safe, 3=EIP-1271
  uint256 timestamp;         // creation, NOT expiry
  bytes32 metadata;
  bytes32 builder;
}
```

Rust mirror in `references/Polymarket-rs-clob-client-v2/src/clob/types/mod.rs:490-507` with `U256` amounts serialized as JSON strings, `salt` as a JSON number.

`ORDER_TYPEHASH` is precomputed (Structs.sol:25). EIP-712 domain is
`"Polymarket CTF Exchange"` / `version "2"` (`Hashing.sol:11-12`). Signature
dispatch lives in `Signatures.sol:68-88` — Solady's `SignatureCheckerLib`
handles EOA + Proxy + Safe + EIP-1271 in one call.

**BUFI's equivalent:** model an `Intent` struct in
`crates/matcher-types/src/eip712.rs` with our nonce model instead of salt:

```
struct Intent {
  bytes32 marketId;     // FxMarketRegistry id
  address account;
  uint8   side;
  uint8   orderType;    // limit | market
  uint8   tif;          // GTC | IOC | FOK
  uint256 size;         // 6-dec USDC
  uint256 limitPrice;   // 18-dec WAD
  uint64  nonce;
  uint64  expiresAtMs;
  bytes32 clientTag;
}
```

Use `alloy-sol-types` to generate the typehash + EIP-712 hashing.

### Settlement model

`Trading.matchOrders` (`references/Polymarket-ctf-exchange-v2/src/exchange/mixins/Trading.sol:78-147`) settles **every fill atomically on-chain in one transaction** initiated by a trusted operator. No batched netting across multiple takers — each `matchOrders` call is one taker × N makers. Operator submits, not the matcher.

`orderStatus[hash]` is a packed `(filled: bool, remaining: uint248)` (assembly-optimised at lines 692-714). Refilling a fully-filled order reverts with `OrderAlreadyFilled()`.

There is **no on-chain cancel**. Operators "cancel" by forgetting an order. Pre-approved orders can be invalidated via `invalidatePreapprovedOrder(orderHash)` (`CTFExchange.sol:78`) — rare.

**For BUFI:** keepers (`apps/keeper-perps-matcher`) play the operator role. The matcher emits fills on Redis, the keeper batches and submits. Cancellation never hits chain.

### Self-trade

Polymarket does NOT prevent `taker.maker == maker.maker`. They rely on the off-chain matcher and operator to filter. We do the same in v1.

### What Polymarket does NOT show us

- **No LP backstop**: `matchOrders` reverts if makers don't cross. BUFI's hybrid model is net-new ground.
- **No funding rate** (Polymarket is binary outcomes, not perps).
- **No mark-price oracle integration** — they price implicitly via `makerAmount/takerAmount` ratio.

We take the **shape** from Polymarket (signed-intent + operator-settled per-fill) and graft the LP + funding + mark-price work from Drift on top.

### Cited files

- `references/Polymarket-ctf-exchange-v2/src/exchange/CTFExchange.sol:48-66, 78`
- `references/Polymarket-ctf-exchange-v2/src/exchange/libraries/Structs.sol:25-89`
- `references/Polymarket-ctf-exchange-v2/src/exchange/mixins/Hashing.sol:11-37`
- `references/Polymarket-ctf-exchange-v2/src/exchange/mixins/Signatures.sol:68-88`
- `references/Polymarket-ctf-exchange-v2/src/exchange/mixins/Trading.sol:78-147, 184-220, 684-716`
- `references/Polymarket-rs-clob-client-v2/src/clob/types/mod.rs:490-507, 650-702`

---

## Source 2: dYdX v4 (`proto/`)

### Service surface

dYdX is a Cosmos chain — `MsgPlaceOrder`/`MsgCancelOrder`/`MsgBatchCancel`
(`tx.proto:27-30`) are consensus messages, not gRPC RPCs. The semantic shape
is still right; we adapt to standalone Rust + tonic. Their proposed-operations
injection (`MsgProposedOperations`, `tx.proto:71`) is a validator-only pattern
— skip.

### Streaming book updates — copy this

`query.proto:80-82`:
```
rpc StreamOrderbookUpdates(StreamOrderbookUpdatesRequest)
   returns (stream StreamOrderbookUpdatesResponse);
```

`StreamOrderbookUpdate` (`query.proto:253-264`) carries a `bool snapshot` flag.
When `true`, clients **discard all prior state and rebuild**. Subsequent
messages with `snapshot:false` are diffs. The off-chain update oneof
(`off_chain_updates.proto:105-114`) wraps:

- `OrderPlaceV1` (`off_chain_updates.proto:15-44`)
- `OrderRemoveV1` (`off_chain_updates.proto:48-82`) — includes a removal-reason enum (`EXPIRED`, `CANCELED`, `FILLED`, ...)
- `OrderUpdateV1` (`off_chain_updates.proto:86-89`) — cumulative `total_filled_quantums`, NOT a delta
- `OrderReplaceV1` (`off_chain_updates.proto:92-101`)

**Resync mechanism:** there is no explicit per-message sequence. Clients trust the snapshot signal: on any `snapshot:true`, drop local state, replay forward. **We should add an explicit `sequence_number`** to our diffs so analytics + reconciler can detect gaps without relying solely on snapshot resets.

### Numeric encoding

Everything is integers on the wire (`order.proto`):

- `subticks: uint64` — price unit
- `quantums: uint64` — size unit
- `quantum_conversion_exponent: sint32` — `10^exponent` scaling factor (signed because exponents can be negative)

`ClobPair` carries per-market `SubticksPerTick`, `StepBaseQuantums`,
`QuantumConversionExponent`. Zero floats anywhere in the protos.

**BUFI:** we keep `bytes` for `price`/`size` (u256-encoded WADs and 6-dec
USDC) because our magnitudes are higher than uint64 can fit safely at 18-dec
WAD. dYdX's u64-with-exponent trick is a viable alternative if proto size
matters; not adopting for v1.

### Trade tape

`OrderFillEventV1` (`events.proto:149-186`) — one event per fill, with both
maker and taker order copies, fill amount in base quantums, `sint64` fees
(signed = credits possible), cumulative filled on each side, and a liquidation
flag.

We adopt the same one-event-per-fill model. Add `is_lp_fill: bool` (per
our spec) and `is_liquidation: bool` (Drift parity, useful from day one).

### Cancellation

`MsgCancelOrder` (`tx.proto:86-102`) is fire-and-forget — `MsgCancelOrderResponse {}`. The off-chain stream emits the result as an `OrderRemoveV1` with a status (`BEST_EFFORT_CANCELED`, `CANCELED`, `FILLED`).

**Idempotent**: canceling a non-existent or already-filled order is not an error. We adopt this. Our `CancelResult` returns the status + residual size (Polymarket has no cancel API; dYdX hides residual in the removal event — we put it in the synchronous response).

### Health

dYdX has no engine-specific health RPC — leans on tendermint's `/health`. **We must build our own**:

```
message HealthResponse {
  Status status = 1;              // HEALTHY | DEGRADED | UNHEALTHY
  uint64 match_sequence_number = 2;
  uint64 last_fill_timestamp_ms = 3;
  uint64 uptime_seconds = 4;
  string version = 5;
}
```

Used by load balancers + reconciler to detect a stuck matcher.

### Proto edits to ship with the scaffold

These amend the sketch in `docs/matcher-architecture.md` §gRPC (lines 119-197):

1. Add `BookSubscription{ repeated bytes market_ids = 1; }`.
2. Replace `BookUpdate` with `{ bytes market_id, bool snapshot, repeated PriceLevel levels, uint64 sequence_number, uint64 timestamp_ms }`.
3. `PriceLevel{ Side side, bytes price, bytes size /* 0 = remove level */, uint64 sequence_number }`.
4. Add `TradeSubscription{ repeated bytes market_ids = 1; }`.
5. Add `HealthRequest{}` and `HealthResponse{...}` per above.
6. `CancelResult{ IntentRef intent_id, CancelStatus status, uint64 residual_size }` with `enum CancelStatus { STATUS_UNSPECIFIED=0; CANCELED=1; NOT_FOUND=2; ALREADY_FILLED=3; }`.
7. `Trade{ ..., uint64 maker_cumulative_filled, uint64 taker_cumulative_filled, bool is_liquidation }`.

### What to NOT copy from dYdX

- `MsgProposedOperations` — validator-only.
- `good_til_block` vs `good_til_block_time` split — we use `expires_at_ms` only.
- `SubaccountId` — we key on `account` address; subaccounts are out of scope.
- `client_metadata` arbitrary flags — adds validation surface for no matching benefit.

### Cited files

- `references/dydxprotocol-v4-chain/proto/dydxprotocol/clob/tx.proto:27-30, 71, 86-102`
- `references/dydxprotocol-v4-chain/proto/dydxprotocol/clob/query.proto:80-82, 226-264`
- `references/dydxprotocol-v4-chain/proto/dydxprotocol/clob/order.proto:147-205`
- `references/dydxprotocol-v4-chain/proto/dydxprotocol/indexer/off_chain_updates/off_chain_updates.proto:15-114`
- `references/dydxprotocol-v4-chain/proto/dydxprotocol/indexer/events/events.proto:149-186, 372`

---

## Source 3: joaquinbejar/OrderBook-rs

### Structural template to build from

The cleanest takeaway: **one match loop, parameterised by `MatchMode` (BaseQty | QuoteAmount) and a `StopCondition` enum**. Use this skeleton in `crates/orderbook/src/match_engine.rs`:

```rust
pub fn match_intent(
    book: &mut OrderBook,
    intent: Intent,
    now_ms: u64,
) -> MatchResult {
    let match_side = match intent.side {
        Side::Buy  => &mut book.asks,   // ascending iter
        Side::Sell => &mut book.bids,   // descending iter
    };
    if match_side.is_empty() {
        return MatchResult::resting_or_rejected(intent, now_ms);
    }

    let mut stop = StopCondition::from_intent(&intent);
    let limit = intent.limit_price;

    let levels = match intent.side {
        Side::Buy  => Either::Left(match_side.iter()),
        Side::Sell => Either::Right(match_side.iter().rev()),
    };

    let mut fills = Vec::new();
    for (price, level) in levels {
        if !crosses(*price, limit, intent.side) { break; }
        let qty_cap = stop.level_qty_cap(*price, level.lot_size());
        if qty_cap == 0 { break; }

        let level_match = level.match_against(qty_cap, intent.id, now_ms);
        let executed = qty_cap - level_match.remaining();
        stop.consume(executed, *price);
        fills.extend(level_match.into_fills());

        if stop.is_done() { break; }
    }

    book.cleanup_empty_levels();
    finalise(book, intent, fills, stop, now_ms)
}
```

### Data structures

joaquinbejar uses `crossbeam_skiplist::SkipMap<u128, Arc<PriceLevel>>` per side (`references/joaquinbejar-OrderBook-rs/src/orderbook/book.rs:46-52`). SkipMap is lock-free and concurrent. **We don't need concurrent matching** (one writer per book is the design), so we drop SkipMap in favour of `std::collections::BTreeMap` — deterministic, simpler, lower dependency surface. Per-level FIFO uses `VecDeque<Order>`.

### Numeric types

- Prices: `u128` (book.rs:46, 52). **We use `i64` fixed-point** (18-dec WAD) per our spec — fits all FX magnitudes with headroom and saves 8 bytes per price level. If we ever blow past `i64::MAX / 10^18`, swap to `i128`. Not now.
- Quantities: `u64` (matching.rs:164). **We use `u128`** because USDC at 6 decimals can plausibly hit `u64::MAX` for a very fat institutional fill on a low-decimal market.
- Notional: `u128` for quote-amount mode.

No `f32`/`f64` anywhere in joaquinbejar's matching core. We adopt that and enforce it via `#![deny(clippy::float_arithmetic, clippy::float_cmp)]` at the crate root.

### Time-in-force

joaquinbejar's TIF handling lives outside the core match loop in `modifications.rs:770-842`:

- **FOK**: a non-mutating `peek_match()` walks the levels first; if total available size < intent size, return `InsufficientLiquidity` without touching state.
- **IOC**: matching loop runs; if `remaining > 0` after the loop, drop the remainder, do not enqueue.
- **GTC**: standard — enqueue remainder.

**Adopt the peek-then-execute pattern for FOK.** It's strictly simpler than the rollback model sketched in `docs/matcher-architecture.md` lines 318-330; we should amend the spec to use peek-then-execute.

### Determinism review

The match loop is clean: no HashMap iteration, no RNG, no clock reads. SkipMap iteration is ordered. A thread-local memory pool (matching.rs:280-289) caches allocations — that's fine for single-threaded replay.

### What to reject

- The `pricelevel` external crate (encapsulates Order storage). Implement directly — we control all the types, no need to depend on a generic third party in the safety-critical core.
- `OrderBook<T>` generic data parameter. Monomorphise to a concrete `Order` type with the fields we need.
- The optional `OrderStateTracker` (order_state.rs) — feature-gated overhead we don't need.

### Cited files

- `references/joaquinbejar-OrderBook-rs/src/orderbook/book.rs:46-96`
- `references/joaquinbejar-OrderBook-rs/src/orderbook/matching.rs:75-82, 164-285, 297-558`
- `references/joaquinbejar-OrderBook-rs/src/orderbook/modifications.rs:770-842`
- `references/joaquinbejar-OrderBook-rs/src/orderbook/stp.rs:118-158` (STP factoring pattern — adopt when we tackle STP in Phase 5+)

---

## Source 4: Drift v2 + JELLY incident

### The JELLY mechanic (March 2025, ~$13M HLP loss)

1. Pick a thin-volume perp pair.
2. Wait for an oracle gap or stale window.
3. Submit a market order > 50% of 24h volume on one side.
4. HLP absorbs the entire opposite side with no OI cap.
5. HLP's directional exposure spikes; reserve price diverges from oracle; further trades benefit the attacker.
6. No insurance backstop sized for this; HLP eats the loss.

The single missing guardrail that would have stopped this: a per-market OI cap with a circuit breaker on oracle-mark divergence. Drift has both, baked into `controller/orders.rs` and `state/state.rs`.

### LP backstop invariants — must land in `docs/lp-backstop-design.md` before Phase 4

These 12 are now the minimum acceptance criteria for any LP code. **No exceptions, no `// TODO: add cap`.**

| # | Invariant | Drift reference |
|---|---|---|
| 1 | Per-market max OI cap; LP fill rejected if `oi_after > market.max_open_interest` | `programs/drift/src/state/perp_market.rs` (`max_open_interest`), enforced in `controller/orders.rs` |
| 2 | Mark-oracle divergence circuit breaker: block LP fills if `|mark - oracle| / oracle > 10%` OR `|oracle - twap_5min| / twap > 50%` | `programs/drift/src/state/state.rs` (`PriceDivergenceGuardRails`) |
| 3 | LP delta cap per market: `|lp_long - lp_short| <= lp_delta_limit` | own design — Drift uses share-rebasing; we use explicit cap |
| 4 | Oracle freshness gate: reject LP fill if `now - oracle.ts > ORACLE_MAX_AGE_MS` (proposed: 30s) | `programs/drift/src/state/state.rs` (`ValidityGuardRails`, `slots_before_stale_for_amm`) |
| 5 | Reduce-only on LP-cap breach: if cap hit, LP serves reduce-only fills until unwound | `programs/drift/src/state/perp_market.rs` (`MarketStatus::ReduceOnly`) |
| 6 | Insurance-fund integration: LP losses > threshold burn IF shares before socialising | `programs/drift/src/state/insurance_fund_stake.rs` |
| 7 | Size-dependent LP spread: `spread(size) = base_spread + f(size/avg_size, utilisation)` | `programs/drift/src/math/amm.rs` (reserve price + spread calc) |
| 8 | Per-intent LP fill size cap: `lp_fill <= max_lp_fill_per_intent` (proposed: 10% of LP TVL) | own design — Drift relies on liquidation rather than ingress cap |
| 9 | Reserve-price vs oracle check: pause LP if `|reserve - oracle| > threshold` | `programs/drift/src/controller/orders.rs` (`validate_market_within_price_band`) |
| 10 | LP market-status veto: respects `MarketStatus::ReduceOnly`/`Paused` from the registry | `programs/drift/src/state/perp_market.rs` |
| 11 | Funding settles before LP unwind: pending funding accrual must flush before position shrinks | `programs/drift/src/controller/funding.rs` |
| 12 | LP fills audit-trail-equivalent to CLOB fills: `Fill{is_lp_fill: true}`, reconciler diffs against `lp_state.position_delta` | own design, surfaces in `crates/matcher-server/src/lp_router.rs` |

Pre-Phase-4 work: create `docs/lp-backstop-design.md` as a hostile-design doc that walks through JELLY step-by-step and shows which of these 12 trips first at each step.

### Cited files

- `references/drift-labs-protocol-v2/programs/drift/src/state/perp_market.rs`
- `references/drift-labs-protocol-v2/programs/drift/src/state/state.rs`
- `references/drift-labs-protocol-v2/programs/drift/src/controller/orders.rs`
- `references/drift-labs-protocol-v2/programs/drift/src/controller/lp.rs`
- `references/drift-labs-protocol-v2/programs/drift/src/controller/funding.rs`
- `references/drift-labs-protocol-v2/programs/drift/src/state/insurance_fund_stake.rs`
- JELLY incident: public post-mortems (Hyperliquid blog March 2025, third-party DeFi-incident trackers) — link out from `docs/lp-backstop-design.md` when written.

---

## Open questions surfaced by the reading pass

These were not on the spec's open-questions list and need answers before
Phase 1 code lands:

1. **Operator vs matcher split for settlement.** Polymarket has a separate
   trusted operator role. Our spec collapses matcher + operator into one
   process. Is that acceptable to the audit story, or do we need a separate
   operator binary that signs the keeper-side tx? Strawman: keep collapsed
   for v1, document the threat model, split in v1.x if auditors require.
2. **Wire encoding for price/size: `bytes` vs dYdX's `uint64 + sint32 exp`.**
   `bytes` is what the spec proposes and what we're going with. Confirm in
   Phase 1 — switching later is a proto-breaking change.
3. **Snapshot cadence on `StreamBook`.** dYdX implicitly resends snapshots
   when needed. What's our policy — periodic (every 60s), event-driven (only
   on reconnect), or both? Strawman: snapshot on subscribe + every 5 min as
   keepalive + on diff-stream gap.
4. **Per-account OI vs per-market OI for LP gating.** Drift gates on
   per-market; our spec is silent. Strawman: gate on both, with per-account
   = 10% of per-market.
5. **Self-trade prevention deferral.** Confirmed deferred to Phase 5+. Make
   sure the proto leaves room (`Intent.client_tag` is the natural place to
   plug an STP group id later).

---

## Next steps

1. Apply the proto edits (rows 1-7 above) to the spec doc as the scaffold lands.
2. Scaffold `services/matcher/` per the spec's repo layout, using the
   structural template from joaquinbejar for `match_engine.rs`.
3. Write `docs/lp-backstop-design.md` as a separate task before Phase 4
   begins — landing the 12 invariants and the JELLY walkthrough.
4. Stand up `references/actionbook-rust-skills/` skills (already symlinked
   into `.claude/skills/`) — invoke `/rust-router` and `/domain-fintech`
   when designing crate boundaries during the scaffold step.
