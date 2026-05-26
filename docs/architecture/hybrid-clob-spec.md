# Hybrid CLOB Architecture Spec

> Upgrade BUFI perps from async intent-matcher to a dYdX v4-style Hybrid CLOB.
> Off-chain Rust sequencer with in-memory order book, WebSocket submission,
> sub-second matching, batch settlement on Arc.

## 1. System Overview

```
Current Architecture:

  Trader Browser
       |
       | EIP-712 sign + POST /perps/intents
       v
  apps/api (Hono REST)
       |
       | SQLite insert (perp_order_intents)
       v
  Rust Matcher (tick loop, polls every 1-30s)
       |
       | match_intent() per market
       | settle_batch() -> settleMatch() on-chain
       v
  Arc Testnet (chain 5042002)
  FxOrderSettlement @ 0x0F62FCdA...


Target Architecture (Hybrid CLOB):

  Trader Browser / API Client
       |
       | WebSocket: { action: "place", signedOrder, signature }
       v
  +----------------------------------------------+
  |  SEQUENCER (Rust, single process)            |
  |                                              |
  |  +---------------------------------------+   |
  |  | WebSocket Gateway (tokio-tungstenite) |   |
  |  |  - auth / rate-limit / signature check|   |
  |  +-----------------+---------------------+   |
  |                    |                          |
  |  +-----------------v---------------------+   |
  |  | In-Memory Order Book (persistent CLOB)|   |
  |  |  BTreeMap<Price, VecDeque<Order>>     |   |
  |  |  per-market, price-time priority      |   |
  |  |  single-writer thread (no lock)       |   |
  |  +-----------------+---------------------+   |
  |                    |                          |
  |  +-----------------v---------------------+   |
  |  | Fill Accumulator / Batch Flusher      |   |
  |  |  collects fills, flushes every N sec  |   |
  |  |  or every M fills -- whichever first  |   |
  |  +-----------------+---------------------+   |
  |                    |                          |
  |  +-----------------v---------------------+   |
  |  | Settlement Worker (reuses existing)   |   |
  |  |  settle_batch() -> Arc Testnet        |   |
  |  |  WAL + rollback on revert             |   |
  |  +---------------------------------------+   |
  |                                              |
  |  +---------------------------------------+   |
  |  | gRPC Surface (kept, Phase 8 compat)   |   |
  |  | Redis Publisher (kept, Phase 8.5b)    |   |
  |  | HTTP /health + /ready (kept)          |   |
  |  +---------------------------------------+   |
  +----------------------------------------------+
       |
       | settleMatch() batched every 2-5s
       v
  Arc Testnet (chain 5042002)
  FxOrderSettlement @ 0x0F62FCdA...
```

## 2. Component Inventory

### Keep As-Is

| Component | Path | Reason |
|-----------|------|--------|
| OrderBook data structure | `crates/orderbook/src/book.rs` | Already `BTreeMap<Price, VecDeque<Order>>` with price-time priority |
| match_intent() engine | `crates/orderbook/src/match_engine.rs` | Pure, deterministic, handles FOK/IOC/GTC |
| EIP-712 typed data | `packages/perps/src/typed-data.ts` + `crates/matcher-types/src/eip712.rs` | Keep signed orders for accountability |
| settlement::settle_one() | `crates/matcher-server/src/settlement.rs` | On-chain settlement logic unchanged |
| LP backstop router | `crates/matcher-server/src/lp_router.rs` | LP routing plugs into residual handling post-match |
| Canary keeper | `crates/matcher-server/src/canary.rs` | Liveness probe, submits via WS instead of DB insert |
| gRPC surface | `crates/matcher-server/src/grpc.rs` | StreamBook, StreamTrades, GetBook remain |
| Redis publisher | `crates/matcher-server/src/realtime.rs` | Broadcast channels unchanged |
| Smart contract | FxOrderSettlement @ 0x0F62FCdA on Arc Testnet | No contract changes needed |

### Modify

| Component | Path | Change |
|-----------|------|--------|
| Tick loop | `crates/matcher-server/src/tick.rs` | Replace DB-poll with batch-flush scheduler |
| matching_lock | `crates/matcher-server/src/grpc.rs:124` | Remove. Single-threaded sequencer, no races |
| submit_order gRPC | `crates/matcher-server/src/grpc.rs:249` | Forward to sequencer channel, await fill |
| Intent translator | `crates/matcher-server/src/intent_translator.rs` | Call at WS ingress instead of from tick |
| REST /perps/intents | `apps/api/src/routes/perps.ts:208` | Deprecate in Phase 2; keep as fallback |
| WS price feed | `apps/api/src/routes/ws.ts` | Source obDelta from real book |
| usePlaceOrder hook | `apps/web/lib/perps/hooks.ts:492` | Submit via WS, optimistic updates |
| usePendingIntents | `apps/web/lib/perps/use-pending-intents.ts` | Subscribe to StreamBook via WS |

### New

| Component | Path | Description |
|-----------|------|-------------|
| WebSocket Gateway | `crates/matcher-server/src/ws_gateway.rs` | WS server, auth, route to sequencer |
| Sequencer Actor | `crates/matcher-server/src/sequencer.rs` | Single-writer event loop: match + emit fills |
| Fill Accumulator | `crates/matcher-server/src/batch_flusher.rs` | Timer-based drain to settlement |
| Book Snapshot WAL | `crates/matcher-server/src/book_wal.rs` | Disk snapshots for crash recovery |
| WS Client (frontend) | `apps/web/lib/perps/ws-sequencer.ts` | TypeScript WS client |
| WS Bridge (API) | `apps/api/src/routes/ws-sequencer.ts` | Browser WS proxy to sequencer |

## 3. Order Lifecycle

```
1. SUBMIT (<1ms)
   Browser -> WS frame { action:"place", signedOrder, signature }

2. VALIDATE (<1ms)
   WS Gateway: EIP-712 signature recovery, deadline check, dedup by nonce

3. MATCH (<1ms, single-threaded)
   Sequencer: match_intent(&mut book[market], intent)
   Fills emitted synchronously. Residual rests (GTC) or drops (IOC/FOK).

4. ACK (<5ms total from submit)
   -> submitter:  { type:"ack", intentId, status, fills }
   -> book subs:  { type:"bookDelta", market, changes, sequence }
   -> trade subs: { type:"trade", fill }

5. BATCH SETTLE (every 2-5s or every 20 fills)
   Drain fill queue -> settle_batch() on-chain
   On success: mark filled, broadcast { type:"settled", txHash }
   On revert: retry up to 3x, then dead-letter

6. CONFIRM (2-10s after match)
   Frontend updates from "pending settlement" -> "confirmed"
```

## 4. WebSocket Protocol Spec

### Connection

```
ws://sequencer:3007/v1/markets
Subprotocol: bufi-clob-v1
Auth: first frame { action:"auth", trader, signature, chainId }
```

### Client -> Server

```jsonc
// Place order
{ "action": "place", "signedOrder": { ... }, "signature": "0x...", "tif": "GTC" }

// Cancel order
{ "action": "cancel", "intentId": "0x...", "marketId": "0x..." }

// Subscribe
{ "action": "subscribe", "channels": ["book:0x...", "trades:0x..."] }
```

### Server -> Client

```jsonc
// Order ack (to submitter only)
{ "type": "ack", "intentId": "0x...", "status": "filled|partial|resting|rejected", "fills": [...] }

// Book snapshot (on subscribe)
{ "type": "bookSnapshot", "marketId": "0x...", "bids": [...], "asks": [...], "sequence": 100 }

// Book delta (incremental)
{ "type": "bookDelta", "marketId": "0x...", "changes": [{ "side": "bid", "price": "...", "size": "..." }], "sequence": 101 }

// Trade broadcast
{ "type": "trade", "fillId": "0x...", "marketId": "0x...", "takerSide": "long", "price": "...", "size": "..." }

// Settlement confirmation
{ "type": "settled", "fillId": "0x...", "txHash": "0x...", "blockNumber": 12345 }
```

## 5. In-Memory Order Book

Existing `crates/orderbook/src/book.rs` already implements the target:

```rust
pub struct OrderBook {
    pub market_id: MarketId,
    pub bids: OrderBookSide,            // BTreeMap<Price, VecDeque<Order>>
    pub asks: OrderBookSide,
    intent_index: BTreeMap<IntentId, (Side, Price)>,  // O(log n) cancel
}
```

Key change: books are persistent across ticks. Today `tick.rs` rebuilds from DB every iteration. In CLOB mode, the book lives for the process lifetime.

New sequencer state:

```rust
pub struct SequencerState {
    books: BTreeMap<[u8; 32], OrderBook>,
    match_seq: u64,
    book_seq: BTreeMap<[u8; 32], u64>,
    pending_fills: VecDeque<PendingFill>,
    intent_store: BTreeMap<[u8; 32], TranslatedIntent>,
}
```

## 6. Batch Settlement Strategy

### Trigger Conditions (whichever fires first)

| Condition | Default | Env Var |
|-----------|---------|---------|
| Time elapsed | 3 seconds | `BATCH_INTERVAL_MS=3000` |
| Fill count | 20 fills | `BATCH_MAX_FILLS=20` |
| Notional cap | $50,000 USDC | `BATCH_NOTIONAL_CAP_E6=50000000000` |

### Rollback Handling

- Sequencer matched but chain reverted: retry settlement 3x, then unwind fills (restore size to both orders)
- Chain settled but sequencer missed it (crash): on restart, WAL replay + event_subscriber reconciliation

## 7. Sequencer Availability

Single-process, single-writer (like dYdX v4's sequencer).

| Failure | Recovery |
|---------|----------|
| Process crash | Restart from book WAL + replay MatchSettled events |
| WS partition | Client reconnects, receives bookSnapshot |
| RPC failure | Fills accumulate, settlement retries when RPC recovers |

### Book WAL

```
Location: $BUFI_DB_PATH/../matcher-book-wal/
Format: bincode-serialized (OrderBook, match_seq, pending_fills)
Frequency: every 5s AND after every settlement batch
```

### Graceful Shutdown

1. Stop accepting new WS connections
2. Flush pending fills (10s timeout)
3. Write final WAL snapshot
4. Exit

## 8. Migration Path

### Phase 1: Persistent Book (3-5 days)

Stop rebuilding the book from DB every tick. Books live in memory, tick feeds new DB rows into them. REST submission unchanged.

### Phase 2: WebSocket Gateway + Sequencer (8-12 days)

New WS ingress path. REST still works as fallback. Both paths merge at the sequencer.

New files: `ws_gateway.rs`, `sequencer.rs`, `batch_flusher.rs`

### Phase 3: Frontend WS Client (5-7 days)

Browser submits via WS. `usePlaceOrder` signs + sends via WS with optimistic updates. `usePendingIntents` subscribes to bookDelta instead of polling.

### Phase 4: Deprecate REST Submission (3-5 days)

Remove tick loop DB-poll. REST POST returns 410 or proxies to WS. DB becomes append-only settlement log.

### Phase 5: WAL + Production Hardening (5-7 days)

Crash recovery, Prometheus metrics (match latency p50/p99, fills/sec, book depth), load test harness (500 orders/sec).

## 9. Smart Contract Changes

None required. Existing `settleMatch()` interface works for batch settlement.

Future optimization: `settleBatch()` function to amortize gas overhead (separate contract upgrade).

Addresses (unchanged):
- FxOrderSettlement: `0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1`
- FxPerpClearinghouse: `0x6A265045D9A3291D2881d77DDC62e2781A2418c5`

## 10. Estimated Effort

| Phase | Duration | Risk |
|-------|----------|------|
| Phase 1: Persistent book | 3-5 days | Low |
| Phase 2: WS Gateway + Sequencer | 8-12 days | Medium |
| Phase 3: Frontend WS client | 5-7 days | Low |
| Phase 4: Deprecate REST | 3-5 days | Medium |
| Phase 5: WAL + hardening | 5-7 days | Medium |
| **Total** | **24-36 days** | |

## 11. Key Decisions

1. **Single-writer sequencer** (not sharded): <10 markets, 10K matches/sec handles 10x projected volume
2. **Optimistic matching, async settlement**: fills in <5ms, settlement batched
3. **Keep EIP-712 signatures**: cryptographic accountability preserved
4. **No consensus layer**: single sequencer appropriate for testnet/early mainnet
5. **DB becomes audit log**: SQLite is append-only fill log, not source of truth
