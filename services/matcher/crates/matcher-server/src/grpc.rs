//! Phase 8 — tonic gRPC server over `proto/matcher.v1.proto`.
//!
//! This module hosts the matcher's external read+write surface for
//! latency-sensitive clients that don't want to round-trip through
//! `apps/api` over HTTP. Bind address comes from `MATCHER_GRPC_BIND`
//! (default `127.0.0.1:3005` — loopback only). Set to empty to disable.
//!
//! ## Surface
//!
//! All six RPCs are wired:
//!   - 8a: Health
//!   - 8b: StreamTrades (broadcast tap from `settle_one`)
//!   - 8c: GetBook + StreamBook (shared per-market book store)
//!   - 8d: SubmitOrder + CancelOrder (synchronous in-thread match
//!     under a shared matching mutex with the tick loop)
//!
//! ## SubmitOrder concurrency model
//!
//! `GrpcState::matching_lock` is a `tokio::sync::Mutex<()>` shared
//! between the tick loop (`tick::run`) and `submit_order`. Both
//! acquire it before invoking `tick::tick`, so:
//!
//!   * Only one match/settle pass runs at a time, eliminating
//!     double-match races on the same pending intent.
//!   * `submit_order` inserts the new intent into the DB **before**
//!     acquiring the lock; whichever party (this call or a
//!     concurrent tick) gets the lock next matches the intent.
//!   * `submit_order` subscribes to the trade broadcast **before**
//!     inserting so it never misses a fill on its own intent, and
//!     filters drained trades by `intent_id` so concurrent fills on
//!     other intents stay out of its `MatchResult.fills`.
//!
//! Latency budget: in the happy path a SubmitOrder costs one tick
//! iteration (list_pending + build_book + match + settleMatch on
//! Arc Testnet). On testnet that is 300–800 ms — exceeds the
//! proto's 200 ms target but is the same envelope as the canary
//! keeper experiences today.

use std::time::Instant;

use std::collections::BTreeMap;
use std::sync::Arc;

use alloy_primitives::{Address, PrimitiveSignature, B256, I256, U256};
use alloy_sol_types::SolStruct;
use bufi_matcher_types::eip712::{domain as eip712_domain, SignedOrder as TypedSignedOrder};
use bufi_matcher_types::proto::matcher::v1::{
    health_response::Status as HealthStatus,
    matcher_server::{Matcher as MatcherSvc, MatcherServer},
    BookSnapshot, BookSubscription, BookUpdate, CancelResult, CancelStatus,
    Fill as ProtoFill, HealthRequest, HealthResponse, IntentRef, MarketRef, MatchResult,
    MatchStatus, OrderType as ProtoOrderType, PriceLevel, Side, SignedOrder, Trade,
    TradeSubscription,
};
use bufi_perps_db::{
    PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide, PerpsDb,
};
use bufi_perps_onchain::{PerpsDeployment, PerpsOnchain};
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tonic::{Request, Response, Status};

use crate::lp_signer::LpSigner;
use crate::lp_state::PathALpStateView;

/// Per-market book snapshot the tick loop publishes after every match
/// pass. Aggregated price levels (bids + asks) so gRPC consumers don't
/// have to know about the matcher's internal Order/queue structure.
/// `sequence_number` is monotonic per market across snapshots — gRPC
/// clients use it to detect dropped updates.
#[derive(Debug, Clone, Default)]
pub struct BookSnapshotData {
    pub bids: Vec<(i128, u128)>,
    pub asks: Vec<(i128, u128)>,
    pub sequence_number: u64,
    pub timestamp_ms: u64,
}

/// Phase 8c — keyed by market_id bytes32, the latest per-market
/// snapshot the tick loop has produced. `RwLock` because the tick loop
/// is the SOLE writer and there can be many gRPC readers (one per
/// active subscriber's snapshot call). Use `tokio::sync::RwLock` so
/// holding it across an `await` is safe.
pub type BookStore = RwLock<BTreeMap<[u8; 32], BookSnapshotData>>;

/// Shared state the gRPC service reads from. Each field is plumbed into
/// the relevant matcher subsystem so the trait impl below only reads.
pub struct GrpcState {
    /// Process start time — drives `HealthResponse.uptime_seconds`.
    pub started_at: Instant,
    /// Set by the tick loop at the start of each iteration; surfaces
    /// via `HealthResponse.match_sequence_number`. Used by external
    /// monitoring to detect a stalled matcher.
    pub match_sequence_number: std::sync::atomic::AtomicU64,
    /// Unix millis of the last successful settleMatch; surfaces via
    /// `HealthResponse.last_fill_timestamp_ms`. 0 if no fill yet.
    pub last_fill_timestamp_ms: std::sync::atomic::AtomicU64,
    /// Phase 8.5a — unix millis of the last completed tick iteration.
    /// Bumped by `tick::run` once per loop. Used by HTTP /ready to
    /// detect a stalled matcher: if `now - last_tick_ms >
    /// ready_max_tick_age`, the matcher is considered not-ready and
    /// /ready returns 503. Independent from `last_fill_timestamp_ms`
    /// (which only updates on real fills; markets can be idle for
    /// hours without that signal moving).
    pub last_tick_ms: std::sync::atomic::AtomicU64,
    /// Phase 8b — every successful `settle_one` builds a `Trade` proto
    /// and sends it here. `StreamTrades` subscribers read from this
    /// channel. Bounded so a slow client can't grow memory; the
    /// `BroadcastStream` adapter surfaces `Lagged` errors which the
    /// stream handler converts into a tonic `Status` (clients
    /// reconnect on lag).
    pub trade_tx: broadcast::Sender<Trade>,
    /// Phase 8c — tick loop publishes the post-match book per market
    /// here. GetBook reads the latest snapshot under a read lock.
    pub book_store: BookStore,
    /// Phase 8c — every published snapshot also goes on this broadcast
    /// so StreamBook subscribers see updates without polling. Bounded
    /// at 64 (smaller than trade_tx because book updates are larger).
    pub book_tx: broadcast::Sender<BookUpdate>,
    /// Phase 8d — serializes match+settle between `tick::run` and
    /// `submit_order`. Both must acquire this before invoking
    /// `tick::tick`. `tokio::sync::Mutex` (not parking_lot) so it
    /// can be held across `.await` points.
    pub matching_lock: Mutex<()>,
}

impl GrpcState {
    pub fn new() -> Self {
        // Capacity 256 — at the matcher's 1-30s tick cadence and even
        // pessimistic 10 fills/tick, a client has ~25s before lag at
        // the steepest cadence. Plenty for a UI; not so big it grows
        // memory under back-pressure.
        let (trade_tx, _) = broadcast::channel(256);
        let (book_tx, _) = broadcast::channel(64);
        Self {
            started_at: Instant::now(),
            match_sequence_number: 0.into(),
            last_fill_timestamp_ms: 0.into(),
            last_tick_ms: 0.into(),
            trade_tx,
            book_store: RwLock::new(BTreeMap::new()),
            book_tx,
            matching_lock: Mutex::new(()),
        }
    }

    /// Convenience for the settlement layer — fire-and-forget. Returns
    /// the count of currently-subscribed receivers (informational).
    pub fn publish_trade(&self, trade: Trade) -> usize {
        self.trade_tx.send(trade).unwrap_or(0)
    }

    /// Phase 8c — called by tick.rs after each market match completes.
    /// Replaces the snapshot in the store, bumps the per-market
    /// sequence number, broadcasts the BookUpdate (snapshot=true; full
    /// re-emit so subscribers stay in sync without diff bookkeeping).
    pub async fn publish_book_snapshot(
        &self,
        market_id: [u8; 32],
        bids: Vec<(i128, u128)>,
        asks: Vec<(i128, u128)>,
    ) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut store = self.book_store.write().await;
        let entry = store.entry(market_id).or_default();
        entry.bids = bids.clone();
        entry.asks = asks.clone();
        entry.sequence_number = entry.sequence_number.saturating_add(1);
        entry.timestamp_ms = now_ms;
        let seq = entry.sequence_number;
        drop(store); // release before broadcast so subscribers can re-read

        let levels = price_levels_proto(&bids, &asks);
        let _ = self.book_tx.send(BookUpdate {
            market_id: market_id.to_vec(),
            snapshot: true,
            levels,
            sequence_number: seq,
            timestamp_ms: now_ms,
        });
    }
}

/// Chain-side handle the service needs in order to actually run
/// SubmitOrder + CancelOrder end-to-end. Optional so unit tests can
/// construct a `MatcherService` with just an `Arc<GrpcState>` (the
/// read-only RPCs — Health, GetBook, StreamBook, StreamTrades — don't
/// need any of this).
///
/// In production, `main.rs` builds this from the same DB + onchain +
/// deployment the tick loop uses, so a synchronous SubmitOrder runs
/// against the same state the keeper would settle from on the next
/// tick anyway.
#[derive(Clone)]
pub struct ChainBackend {
    pub db: PerpsDb,
    pub onchain: PerpsOnchain,
    pub deployment: PerpsDeployment,
    pub chain_id: i64,
}

/// The tonic service implementation. Holds an `Arc<GrpcState>` so
/// multiple clones (one per inbound connection) share the same hot
/// counters without contention. `chain` is `None` only in unit tests
/// — production always plumbs it in.
pub struct MatcherService {
    state: Arc<GrpcState>,
    chain: Option<ChainBackend>,
}

impl MatcherService {
    /// State-only constructor used by unit tests of the read-only
    /// RPCs. Production code paths must use `with_chain` so
    /// SubmitOrder + CancelOrder have the DB/onchain handle they
    /// need.
    #[cfg(test)]
    pub fn new(state: Arc<GrpcState>) -> Self {
        Self { state, chain: None }
    }

    /// Production constructor — wires the chain backend so SubmitOrder
    /// and CancelOrder can run end-to-end against the matcher's DB
    /// and the deployed FxOrderSettlement contract.
    pub fn with_chain(state: Arc<GrpcState>, chain: ChainBackend) -> Self {
        Self {
            state,
            chain: Some(chain),
        }
    }

    /// Build a tower-compatible service for `Server::builder().add_service(...)`.
    pub fn into_server(self) -> MatcherServer<Self> {
        MatcherServer::new(self)
    }
}

// Stream type aliases — tonic returns a `Pin<Box<dyn Stream>>` for every
// streaming RPC and we want one named type per stream so the trait impl
// reads cleanly. All three are placeholders today (immediately closes
// with `Unimplemented`); 8b/8c replace them with real streams.
type BoxStream<T> =
    std::pin::Pin<Box<dyn Stream<Item = Result<T, Status>> + Send + 'static>>;

#[tonic::async_trait]
impl MatcherSvc for MatcherService {
    async fn submit_order(
        &self,
        req: Request<SignedOrder>,
    ) -> Result<Response<MatchResult>, Status> {
        let chain = self.chain.as_ref().ok_or_else(|| {
            Status::failed_precondition(
                "MatcherService constructed without ChainBackend — SubmitOrder requires \
                 the production wiring (db + onchain + deployment + chain_id). \
                 Use `MatcherService::with_chain` in main.rs.",
            )
        })?;
        let proto_order = req.into_inner();

        // 1. Parse + verify signature. The recovered address must match
        //    the trader field on the wire — same invariant the on-chain
        //    `settleMatch` enforces.
        let parsed = parse_and_verify(&proto_order, &chain.deployment)?;
        let intent_id_hex = format!("0x{}", alloy_primitives::hex::encode(parsed.intent_id));

        let now_secs = current_unix_secs();
        if (parsed.typed.deadline as i64) <= now_secs {
            return Err(Status::failed_precondition(format!(
                "deadline {} has passed (now = {now_secs})",
                parsed.typed.deadline
            )));
        }

        // 2. Build the DB row and subscribe to the trade broadcast
        //    BEFORE inserting. Subscribing first means we never miss a
        //    fill produced by the very tick that picks up this intent
        //    — broadcast::Sender::subscribe() positions the receiver at
        //    the current tail, so only fills emitted after this point
        //    can land in our drain.
        let perp_intent =
            build_perp_intent_row(&parsed, &proto_order, &intent_id_hex, now_secs, chain.chain_id);
        let mut trade_rx = self.state.trade_tx.subscribe();

        // 3. Persist + acquire matching lock. The lock is shared with
        //    tick::run so only one match/settle pass runs at a time.
        chain
            .db
            .put(&perp_intent)
            .await
            .map_err(|e| Status::internal(format!("db put: {e}")))?;
        let _guard = self.state.matching_lock.lock().await;

        // 4. Run a tick. This matches every pending intent in the
        //    deployment's chain, including ours, then settles
        //    sequentially via settleMatch on Arc. We pass `None` for
        //    LP routing because the production wiring path that
        //    plumbs LpSigner into the gRPC handler isn't built yet —
        //    a residual under GTC simply rests on the book and a
        //    future tick will route it once the LP wiring lands.
        let _outcome = crate::tick::tick(
            &chain.db,
            &chain.onchain,
            &chain.deployment,
            chain.chain_id,
            None::<(&LpSigner, &PathALpStateView)>,
            Some(self.state.as_ref()),
        )
        .await;
        drop(_guard);

        // 5. Drain trade_rx and keep only the fills involving OUR
        //    intent_id. Other intents may have been matched in the
        //    same tick — those go on the StreamTrades tap but not in
        //    this caller's MatchResult.
        let intent_id_vec = parsed.intent_id.to_vec();
        let mut my_fills: Vec<ProtoFill> = Vec::new();
        while let Ok(trade) = trade_rx.try_recv() {
            if trade.maker_intent_id == intent_id_vec || trade.taker_intent_id == intent_id_vec {
                my_fills.push(trade_to_proto_fill(trade));
            }
        }

        // 6. Look up the post-match DB row to derive MatchStatus from
        //    the canonical state (filled_size_delta + status).
        let post = chain
            .db
            .get(&intent_id_hex)
            .await
            .map_err(|e| Status::internal(format!("db get: {e}")))?
            .ok_or_else(|| Status::internal("intent vanished from DB between put and read"))?;

        let status = match post.status {
            PerpIntentStatus::Filled => MatchStatus::Filled,
            PerpIntentStatus::PartiallyFilled => MatchStatus::Partial,
            PerpIntentStatus::Pending => MatchStatus::Resting,
            PerpIntentStatus::Canceled
            | PerpIntentStatus::Expired
            | PerpIntentStatus::Rejected => MatchStatus::Rejected,
        };
        let reject_reason = if matches!(status, MatchStatus::Rejected) {
            Some(format!("post-tick status = {:?}", post.status))
        } else {
            None
        };

        Ok(Response::new(MatchResult {
            intent_ref: Some(IntentRef {
                intent_id: intent_id_vec,
                market_id: proto_order.market_id.clone(),
            }),
            fills: my_fills,
            status: status as i32,
            reject_reason,
        }))
    }

    async fn cancel_order(
        &self,
        req: Request<IntentRef>,
    ) -> Result<Response<CancelResult>, Status> {
        let chain = self.chain.as_ref().ok_or_else(|| {
            Status::failed_precondition(
                "MatcherService constructed without ChainBackend — CancelOrder requires \
                 the production wiring (db + chain_id). Use `MatcherService::with_chain` \
                 in main.rs.",
            )
        })?;
        let intent_ref = req.into_inner();
        if intent_ref.intent_id.len() != 32 {
            return Err(Status::invalid_argument("intent_id must be 32 bytes"));
        }
        let intent_id_hex = format!("0x{}", alloy_primitives::hex::encode(&intent_ref.intent_id));

        // Take the matching lock so we don't race a concurrent tick
        // that's mid-matching this intent. Once we hold the lock the
        // DB row is stable until we release.
        let _guard = self.state.matching_lock.lock().await;

        let row = chain
            .db
            .get(&intent_id_hex)
            .await
            .map_err(|e| Status::internal(format!("db get: {e}")))?;

        match row {
            None => Ok(Response::new(CancelResult {
                intent_ref: Some(intent_ref),
                status: CancelStatus::NotFound as i32,
                residual_size: vec![0u8; 32],
            })),
            Some(row) => match row.status {
                PerpIntentStatus::Filled => Ok(Response::new(CancelResult {
                    intent_ref: Some(intent_ref),
                    status: CancelStatus::AlreadyFilled as i32,
                    residual_size: vec![0u8; 32],
                })),
                PerpIntentStatus::Canceled
                | PerpIntentStatus::Expired
                | PerpIntentStatus::Rejected => Ok(Response::new(CancelResult {
                    intent_ref: Some(intent_ref),
                    status: CancelStatus::NotFound as i32,
                    residual_size: vec![0u8; 32],
                })),
                PerpIntentStatus::Pending | PerpIntentStatus::PartiallyFilled => {
                    let now_secs = current_unix_secs();
                    chain
                        .db
                        .update_status(&intent_id_hex, PerpIntentStatus::Canceled, now_secs)
                        .await
                        .map_err(|e| Status::internal(format!("db update_status: {e}")))?;
                    let residual_e18 = residual_magnitude_e18(&row);
                    Ok(Response::new(CancelResult {
                        intent_ref: Some(intent_ref),
                        status: CancelStatus::Canceled as i32,
                        residual_size: u128_to_be32(residual_e18),
                    }))
                }
            },
        }
    }

    async fn get_book(
        &self,
        req: Request<MarketRef>,
    ) -> Result<Response<BookSnapshot>, Status> {
        // Phase 8c — read the tick loop's published snapshot. Empty
        // levels (no entry in the store yet) returns an empty snapshot
        // rather than NotFound; the matcher might just not have ticked
        // the market yet on a fresh boot.
        let MarketRef { market_id } = req.into_inner();
        let market_bytes: [u8; 32] = market_id
            .as_slice()
            .try_into()
            .map_err(|_| Status::invalid_argument("market_id must be 32 bytes"))?;
        let store = self.state.book_store.read().await;
        let (bids, asks, seq, ts) = match store.get(&market_bytes) {
            Some(snap) => (
                snap.bids.clone(),
                snap.asks.clone(),
                snap.sequence_number,
                snap.timestamp_ms,
            ),
            None => (Vec::new(), Vec::new(), 0, 0),
        };
        drop(store);
        Ok(Response::new(BookSnapshot {
            market_id,
            bids: bids
                .iter()
                .map(|(p, s)| PriceLevel {
                    side: Side::Long as i32,
                    price: i128_to_be32(*p),
                    size: u128_to_be32(*s),
                    sequence_number: seq,
                })
                .collect(),
            asks: asks
                .iter()
                .map(|(p, s)| PriceLevel {
                    side: Side::Short as i32,
                    price: i128_to_be32(*p),
                    size: u128_to_be32(*s),
                    sequence_number: seq,
                })
                .collect(),
            sequence_number: seq,
            timestamp_ms: ts,
        }))
    }

    type StreamBookStream = BoxStream<BookUpdate>;
    async fn stream_book(
        &self,
        req: Request<BookSubscription>,
    ) -> Result<Response<Self::StreamBookStream>, Status> {
        // Phase 8c — subscribe to the book broadcast. Initial frame is
        // a `snapshot=true` for every requested market that has data
        // (or all markets if `market_ids` is empty), built from the
        // current `book_store`. Subsequent frames come from the
        // broadcast filtered by market_ids.
        let BookSubscription { market_ids } = req.into_inner();
        let filter: Option<std::collections::HashSet<Vec<u8>>> = if market_ids.is_empty() {
            None
        } else {
            Some(market_ids.iter().cloned().collect())
        };

        // Materialise the initial snapshots under the read lock.
        let initials: Vec<BookUpdate> = {
            let store = self.state.book_store.read().await;
            store
                .iter()
                .filter(|(mid, _)| match &filter {
                    Some(set) => set.contains(&mid.to_vec()),
                    None => true,
                })
                .map(|(mid, snap)| BookUpdate {
                    market_id: mid.to_vec(),
                    snapshot: true,
                    levels: price_levels_proto(&snap.bids, &snap.asks),
                    sequence_number: snap.sequence_number,
                    timestamp_ms: snap.timestamp_ms,
                })
                .collect()
        };

        let rx = self.state.book_tx.subscribe();
        let follow_up = BroadcastStream::new(rx).filter_map(move |item| match item {
            Ok(upd) => match &filter {
                Some(set) if !set.contains(&upd.market_id) => None,
                _ => Some(Ok(upd)),
            },
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(skipped)) => {
                Some(Err(Status::resource_exhausted(format!(
                    "book stream lagged {skipped} updates; reconnect to resubscribe"
                ))))
            }
        });

        // Initial snapshots first, then follow-ups. Wrap the initial
        // Vec in a stream so the two compose via `chain`.
        let initial_stream =
            tokio_stream::iter(initials.into_iter().map(Ok::<BookUpdate, Status>));
        let combined = initial_stream.chain(follow_up);
        Ok(Response::new(Box::pin(combined)))
    }

    type StreamTradesStream = BoxStream<Trade>;
    async fn stream_trades(
        &self,
        req: Request<TradeSubscription>,
    ) -> Result<Response<Self::StreamTradesStream>, Status> {
        // Phase 8b — tap the broadcast tied to `settle_one`. Optional
        // market_ids filter; empty = firehose. Lagged subscribers get
        // a typed error so the client knows to reconnect (rather than
        // silently drop fills).
        let TradeSubscription { market_ids } = req.into_inner();
        let filter: Option<std::collections::HashSet<Vec<u8>>> = if market_ids.is_empty() {
            None
        } else {
            Some(market_ids.into_iter().collect())
        };
        let rx = self.state.trade_tx.subscribe();
        let stream = BroadcastStream::new(rx).filter_map(move |item| match item {
            Ok(trade) => match &filter {
                Some(set) if !set.contains(&trade.market_id) => None,
                _ => Some(Ok(trade)),
            },
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(skipped)) => {
                Some(Err(Status::resource_exhausted(format!(
                    "stream lagged {skipped} fills; reconnect to resubscribe"
                ))))
            }
        });
        Ok(Response::new(Box::pin(stream)))
    }

    async fn health(
        &self,
        _req: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        let uptime = self.state.started_at.elapsed().as_secs();
        let seq = self
            .state
            .match_sequence_number
            .load(std::sync::atomic::Ordering::Relaxed);
        let last_fill_ms = self
            .state
            .last_fill_timestamp_ms
            .load(std::sync::atomic::Ordering::Relaxed);

        // Health classification:
        //   HEALTHY    — at least one fill in the last 5 minutes OR fresh boot
        //                (uptime < 30s, no fills yet is expected)
        //   DEGRADED   — uptime > 30s and no fill in last 10 minutes (quiet
        //                market or upstream issue; not a hard failure)
        //   UNHEALTHY  — never used today; reserved for explicit health
        //                degradation signals (DB write failures, RPC outages)
        //                wired in a future phase.
        let status = if last_fill_ms == 0 && uptime < 30 {
            HealthStatus::Healthy
        } else if last_fill_ms == 0 {
            HealthStatus::Degraded
        } else {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let age_secs = now_ms.saturating_sub(last_fill_ms) / 1_000;
            if age_secs > 600 {
                HealthStatus::Degraded
            } else {
                HealthStatus::Healthy
            }
        };

        Ok(Response::new(HealthResponse {
            status: status as i32,
            match_sequence_number: seq,
            last_fill_timestamp_ms: last_fill_ms,
            uptime_seconds: uptime,
            version: env!("CARGO_PKG_VERSION").to_string(),
        }))
    }
}

// ---------------------------------------------------------------------------
// Fill → Trade adapter (Phase 8b)
//
// The matcher's internal `bufi_orderbook::Fill` carries enough info to
// build the proto `Trade` directly. Cumulative fields come from the
// post-`record_fill` DB row magnitudes (signed sizeDelta). All u256
// fields use 32-byte big-endian for proto-wire stability.
// ---------------------------------------------------------------------------

/// Build a proto `Trade` from a matcher Fill + the post-settle
/// cumulative magnitudes (in 18-dec WAD as `i128`). LP / liquidation
/// flags are passed explicitly so the settlement layer chooses based
/// on its own knowledge (the Fill type carries `is_lp_fill` already).
pub fn fill_to_proto_trade(
    fill: &bufi_orderbook::Fill,
    maker_cumulative_e18: i128,
    taker_cumulative_e18: i128,
    is_liquidation: bool,
) -> Trade {
    Trade {
        fill_id: fill.fill_id.to_vec(),
        maker_intent_id: fill.maker_intent_id.to_vec(),
        taker_intent_id: fill.taker_intent_id.to_vec(),
        market_id: fill.market_id.to_vec(),
        taker_side: match fill.taker_side {
            bufi_orderbook::Side::Long => Side::Long as i32,
            bufi_orderbook::Side::Short => Side::Short as i32,
        },
        // Price + size: Fill stores i128/u128; widen to 32-byte BE for
        // wire portability so consumers in other languages don't have
        // to know the matcher's internal bit-width.
        price: i128_to_be32(fill.price.raw()),
        size: u128_to_be32(fill.size.raw()),
        timestamp_ms: fill.timestamp_ms,
        maker_cumulative_filled: i128_to_be32(maker_cumulative_e18),
        taker_cumulative_filled: i128_to_be32(taker_cumulative_e18),
        is_lp_fill: fill.is_lp_fill,
        is_liquidation,
    }
}

/// Encode an `i128` as a 32-byte two's-complement big-endian buffer.
/// Sign-extends across the upper 16 bytes.
fn i128_to_be32(v: i128) -> Vec<u8> {
    let mut buf = if v < 0 { vec![0xffu8; 32] } else { vec![0u8; 32] };
    buf[16..].copy_from_slice(&v.to_be_bytes());
    buf
}

/// Encode a `u128` as a 32-byte zero-padded big-endian buffer.
fn u128_to_be32(v: u128) -> Vec<u8> {
    let mut buf = vec![0u8; 32];
    buf[16..].copy_from_slice(&v.to_be_bytes());
    buf
}

/// Convert per-side aggregated levels into the wire-format `PriceLevel`s
/// the StreamBook / BookUpdate messages carry. Each level's
/// `sequence_number` is 0 today — the parent BookUpdate's
/// `sequence_number` is authoritative; per-level seq is reserved for a
/// future diff-broadcast mode.
pub fn price_levels_proto(
    bids: &[(i128, u128)],
    asks: &[(i128, u128)],
) -> Vec<PriceLevel> {
    let mut out = Vec::with_capacity(bids.len() + asks.len());
    for (p, s) in bids {
        out.push(PriceLevel {
            side: Side::Long as i32,
            price: i128_to_be32(*p),
            size: u128_to_be32(*s),
            sequence_number: 0,
        });
    }
    for (p, s) in asks {
        out.push(PriceLevel {
            side: Side::Short as i32,
            price: i128_to_be32(*p),
            size: u128_to_be32(*s),
            sequence_number: 0,
        });
    }
    out
}

/// One aggregated level: `(price_e18, total_size_e18)`. Used for both
/// bid and ask sides of `LevelsByDirection`.
pub type AggregatedLevel = (i128, u128);

/// Bids + asks split per direction. Bids are ordered descending (best
/// first); asks ascending (best first). Used everywhere the gRPC layer
/// shuttles aggregated levels between the matcher and the wire.
pub type LevelsByDirection = (Vec<AggregatedLevel>, Vec<AggregatedLevel>);

/// Extract aggregated levels from a live `OrderBook`. Bids come back in
/// descending price order (best bid first); asks in ascending (best ask
/// first). Tick.rs calls this after every per-market match pass and
/// hands the result to `GrpcState::publish_book_snapshot`.
pub fn extract_book_levels(
    book: &bufi_orderbook::OrderBook,
) -> LevelsByDirection {
    let bid_levels: Vec<(i128, u128)> = book
        .bids
        .levels_ascending()
        .map(|(price, queue)| {
            let total: u128 = queue.iter().map(|o| o.remaining.raw()).sum();
            (price.raw(), total)
        })
        .collect();
    let ask_levels: Vec<(i128, u128)> = book
        .asks
        .levels_ascending()
        .map(|(price, queue)| {
            let total: u128 = queue.iter().map(|o| o.remaining.raw()).sum();
            (price.raw(), total)
        })
        .collect();

    // Bids descending (best first). levels_ascending returns ascending,
    // so reverse.
    let mut bids = bid_levels;
    bids.reverse();
    (bids, ask_levels)
}

// ---------------------------------------------------------------------------
// SubmitOrder / CancelOrder helpers (Phase 8d)
// ---------------------------------------------------------------------------

/// Output of `parse_and_verify`. Carries the typed (sol!) order, the
/// 32-byte intent_id (EIP-712 hash) and the trader recovered from the
/// signature. Returned together so the caller doesn't need to re-derive
/// any of these.
#[derive(Debug)]
struct ParsedOrder {
    typed: TypedSignedOrder,
    intent_id: [u8; 32],
    trader: Address,
    /// Raw signature bytes (65 = r || s || v). Stored straight on the
    /// PerpIntent row as `0x…130 hex chars`.
    signature: Vec<u8>,
}

/// Parse a proto `SignedOrder` into the sol! `TypedSignedOrder`,
/// compute the EIP-712 digest (= intent_id), verify the signature
/// recovers to the wire-stated trader. Returns a single bundle so the
/// caller doesn't re-parse or re-hash.
///
/// All `Status::invalid_argument` errors so the client knows it's a
/// malformed request, not a server-side fault.
#[allow(clippy::result_large_err)]
fn parse_and_verify(
    proto: &SignedOrder,
    deployment: &PerpsDeployment,
) -> Result<ParsedOrder, Status> {
    let trader = parse_address_bytes(&proto.trader)?;
    let market_id = parse_bytes32(&proto.market_id, "market_id")?;
    let size_delta = parse_int256(&proto.size_delta_e18, "size_delta_e18")?;
    if size_delta == I256::ZERO {
        return Err(Status::invalid_argument("size_delta_e18 must be nonzero"));
    }
    let price_e18 = parse_uint256(&proto.price_e18, "price_e18")?;
    let max_fee = parse_uint256(&proto.max_fee, "max_fee")?;

    let order_type_u8 = match ProtoOrderType::try_from(proto.order_type) {
        Ok(ProtoOrderType::Market) => 0u8,
        Ok(ProtoOrderType::Limit) => 1u8,
        Err(_) => {
            return Err(Status::invalid_argument(format!(
                "order_type {} not in {{MARKET, LIMIT}}",
                proto.order_type
            )))
        }
    };
    if proto.flags > u8::MAX as u32 {
        return Err(Status::invalid_argument(
            "flags must fit in uint8 (on-chain narrows to uint8)",
        ));
    }
    let flags = proto.flags as u8;

    let typed = TypedSignedOrder {
        trader,
        marketId: market_id,
        sizeDeltaE18: size_delta,
        priceE18: price_e18,
        maxFee: max_fee,
        orderType: order_type_u8,
        flags,
        nonce: proto.nonce,
        deadline: proto.deadline_secs,
    };
    let domain = eip712_domain(deployment.chain_id, deployment.contracts.fx_order_settlement);
    let digest: B256 = typed.eip712_signing_hash(&domain);

    if proto.signature.len() != 65 {
        return Err(Status::invalid_argument(format!(
            "signature must be 65 bytes (r||s||v), got {}",
            proto.signature.len()
        )));
    }
    let sig = PrimitiveSignature::try_from(proto.signature.as_slice())
        .map_err(|e| Status::invalid_argument(format!("signature parse: {e}")))?;
    let recovered = sig
        .recover_address_from_prehash(&digest)
        .map_err(|e| Status::invalid_argument(format!("signature recovery failed: {e}")))?;
    if recovered != trader {
        return Err(Status::invalid_argument(format!(
            "signature recovers to {recovered:#x}, expected trader {trader:#x}"
        )));
    }

    Ok(ParsedOrder {
        typed,
        intent_id: digest.0,
        trader,
        signature: proto.signature.clone(),
    })
}

/// Convert the parsed order + the original proto request into a
/// `PerpIntent` DB row. Same shape the canary keeper builds in
/// `canary::Canary::build_perp_intent`; kept here so SubmitOrder is
/// self-contained and the two paths can drift independently.
fn build_perp_intent_row(
    parsed: &ParsedOrder,
    proto: &SignedOrder,
    intent_id_hex: &str,
    now_secs: i64,
    chain_id: i64,
) -> PerpIntent {
    let size_delta_str = parsed.typed.sizeDeltaE18.to_string();
    let side = if parsed.typed.sizeDeltaE18.is_negative() {
        PerpSide::Short
    } else {
        PerpSide::Long
    };
    let order_type = match parsed.typed.orderType {
        0 => PerpOrderType::Market,
        _ => PerpOrderType::Limit,
    };
    let reduce_only = (parsed.typed.flags & 0x01) != 0;
    let post_only = (parsed.typed.flags & 0x02) != 0;

    PerpIntent {
        intent_id: intent_id_hex.to_string(),
        replacement_of: None,
        chain_id,
        trader: format!("{:#x}", parsed.trader),
        market_id: format!("0x{}", alloy_primitives::hex::encode(proto.market_id.as_slice())),
        side,
        // size_usdc is a UI-echo field (see lp_router.rs:109). 0 is
        // safe; consumers that want the real notional re-derive from
        // size_delta * price.
        size_usdc: "0".to_string(),
        size_delta: size_delta_str.clone(),
        filled_size_delta: "0".to_string(),
        remaining_size_delta: size_delta_str,
        // Leverage is a UI-only field today; the matcher doesn't
        // consume it. 1 is a safe default.
        leverage: 1,
        order_type,
        price_e18: parsed.typed.priceE18.to_string(),
        limit_price: None,
        reduce_only,
        post_only,
        flags: parsed.typed.flags as i64,
        digest: intent_id_hex.to_string(),
        signature: format!("0x{}", alloy_primitives::hex::encode(&parsed.signature)),
        nonce: parsed.typed.nonce.to_string(),
        deadline: parsed.typed.deadline as i64,
        status: PerpIntentStatus::Pending,
        created_at: now_secs,
        updated_at: now_secs,
    }
}

/// Adapter: the broadcast tap publishes `Trade`s, but MatchResult
/// carries the (lighter) `Fill` shape. We shed the cumulative-filled
/// and is_liquidation fields and ship the rest.
fn trade_to_proto_fill(trade: Trade) -> ProtoFill {
    ProtoFill {
        fill_id: trade.fill_id,
        maker_intent_id: trade.maker_intent_id,
        taker_intent_id: trade.taker_intent_id,
        market_id: trade.market_id,
        taker_side: trade.taker_side,
        price: trade.price,
        size: trade.size,
        timestamp_ms: trade.timestamp_ms,
        is_lp_fill: trade.is_lp_fill,
    }
}

/// |size_delta| - |filled_size_delta| as a u128. Both columns are
/// signed-decimal strings; we operate on |x| because the sign just
/// encodes the side, not the magnitude. Returns 0 if either parse
/// fails (defensive — the matcher should never write malformed rows).
fn residual_magnitude_e18(row: &PerpIntent) -> u128 {
    let size: i128 = row.size_delta.parse().unwrap_or(0);
    let filled: i128 = row.filled_size_delta.parse().unwrap_or(0);
    size.unsigned_abs().saturating_sub(filled.unsigned_abs())
}

// Tonic's Status is large (~176 bytes) and Result<small, Status>
// trips clippy::result_large_err in the small helpers below. They're
// only called from `parse_and_verify` which already returns
// Result<ParsedOrder, Status>, so the lint doesn't materially help
// here — the size disparity is structural to the tonic API.
#[allow(clippy::result_large_err)]
fn parse_address_bytes(bytes: &[u8]) -> Result<Address, Status> {
    if bytes.len() != 20 {
        return Err(Status::invalid_argument(format!(
            "trader must be 20 bytes, got {}",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 20];
    arr.copy_from_slice(bytes);
    Ok(Address::from(arr))
}

#[allow(clippy::result_large_err)]
fn parse_bytes32(bytes: &[u8], field: &str) -> Result<B256, Status> {
    if bytes.len() != 32 {
        return Err(Status::invalid_argument(format!(
            "{field} must be 32 bytes, got {}",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Ok(B256::from(arr))
}

#[allow(clippy::result_large_err)]
fn parse_int256(bytes: &[u8], field: &str) -> Result<I256, Status> {
    if bytes.len() != 32 {
        return Err(Status::invalid_argument(format!(
            "{field} must be 32 bytes (i256 BE two's-complement), got {}",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Ok(I256::from_be_bytes(arr))
}

#[allow(clippy::result_large_err)]
fn parse_uint256(bytes: &[u8], field: &str) -> Result<U256, Status> {
    if bytes.len() != 32 {
        return Err(Status::invalid_argument(format!(
            "{field} must be 32 bytes (u256 BE), got {}",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Ok(U256::from_be_bytes(arr))
}

fn current_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn health_fresh_boot_reports_healthy() {
        let state = Arc::new(GrpcState::new());
        let svc = MatcherService::new(state);
        let resp = svc
            .health(Request::new(HealthRequest {}))
            .await
            .expect("health should succeed");
        let body = resp.into_inner();
        assert_eq!(body.status, HealthStatus::Healthy as i32);
        assert_eq!(body.match_sequence_number, 0);
        assert_eq!(body.last_fill_timestamp_ms, 0);
        assert!(body.uptime_seconds < 5);
        assert_eq!(body.version, env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn submit_order_without_chain_returns_failed_precondition() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let err = svc
            .submit_order(Request::new(SignedOrder::default()))
            .await
            .expect_err("must fail because no ChainBackend was supplied");
        assert_eq!(err.code(), tonic::Code::FailedPrecondition);
        assert!(err.message().contains("with_chain"));
    }

    #[tokio::test]
    async fn cancel_order_without_chain_returns_failed_precondition() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let err = svc
            .cancel_order(Request::new(IntentRef {
                intent_id: vec![0u8; 32],
                market_id: vec![0u8; 32],
            }))
            .await
            .expect_err("must fail because no ChainBackend was supplied");
        assert_eq!(err.code(), tonic::Code::FailedPrecondition);
        assert!(err.message().contains("with_chain"));
    }

    #[test]
    fn i128_to_be32_round_trips_positive() {
        let v: i128 = 1_000_000_000_000_000_000; // 1e18
        let encoded = i128_to_be32(v);
        assert_eq!(encoded.len(), 32);
        // Upper 16 bytes must be zero for positive values.
        assert!(encoded[..16].iter().all(|b| *b == 0));
        let recovered = i128::from_be_bytes(encoded[16..].try_into().unwrap());
        assert_eq!(recovered, v);
    }

    #[test]
    fn i128_to_be32_sign_extends_negative() {
        let v: i128 = -1_000_000_000_000_000_000;
        let encoded = i128_to_be32(v);
        assert_eq!(encoded.len(), 32);
        // Upper 16 bytes must be 0xff for negative values (two's complement).
        assert!(encoded[..16].iter().all(|b| *b == 0xff));
        let recovered = i128::from_be_bytes(encoded[16..].try_into().unwrap());
        assert_eq!(recovered, v);
    }

    #[test]
    fn u128_to_be32_zero_pads() {
        let v: u128 = u128::MAX;
        let encoded = u128_to_be32(v);
        assert_eq!(encoded.len(), 32);
        assert!(encoded[..16].iter().all(|b| *b == 0));
        assert!(encoded[16..].iter().all(|b| *b == 0xff));
    }

    #[tokio::test]
    async fn stream_trades_delivers_published_trade() {
        use bufi_orderbook::{Fill, Price, Side as ObSide, Size};
        let state = Arc::new(GrpcState::new());
        let svc = MatcherService::new(state.clone());

        let stream_resp = svc
            .stream_trades(Request::new(TradeSubscription { market_ids: vec![] }))
            .await
            .expect("subscribe should succeed");
        let mut stream = stream_resp.into_inner();

        // Publish a fill AFTER the subscriber exists.
        let fill = Fill {
            fill_id: [0x11; 32],
            maker_intent_id: [0x22; 32],
            taker_intent_id: [0x33; 32],
            market_id: [0x44; 32],
            taker_side: ObSide::Long,
            price: Price::new(1_000_000_000_000_000_000),
            size: Size::new(500_000_000_000_000_000),
            timestamp_ms: 1_700_000_000_000,
            is_lp_fill: false,
        };
        let trade = fill_to_proto_trade(&fill, 500_000_000_000_000_000, -500_000_000_000_000_000, false);
        let receivers = state.publish_trade(trade);
        assert_eq!(receivers, 1, "exactly one subscriber active");

        // Read one item back.
        use tokio_stream::StreamExt as _;
        let received = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("timeout waiting for fill")
            .expect("stream ended early")
            .expect("status error");
        assert_eq!(received.fill_id, vec![0x11; 32]);
        assert_eq!(received.maker_intent_id, vec![0x22; 32]);
        assert_eq!(received.market_id, vec![0x44; 32]);
        assert_eq!(received.taker_side, Side::Long as i32);
        assert!(!received.is_lp_fill);
        assert!(!received.is_liquidation);
    }

    #[tokio::test]
    async fn get_book_empty_returns_no_levels() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let resp = svc
            .get_book(Request::new(MarketRef {
                market_id: vec![0xAA; 32],
            }))
            .await
            .expect("get_book on empty store should succeed");
        let body = resp.into_inner();
        assert_eq!(body.market_id, vec![0xAA; 32]);
        assert!(body.bids.is_empty());
        assert!(body.asks.is_empty());
        assert_eq!(body.sequence_number, 0);
    }

    #[tokio::test]
    async fn get_book_returns_published_snapshot() {
        let state = Arc::new(GrpcState::new());
        let svc = MatcherService::new(state.clone());
        let market = [0x44; 32];
        state
            .publish_book_snapshot(
                market,
                vec![(1_000_000_000_000_000_000_i128, 5_000_000_000_000_000_000u128)],
                vec![(1_100_000_000_000_000_000_i128, 3_000_000_000_000_000_000u128)],
            )
            .await;
        let resp = svc
            .get_book(Request::new(MarketRef {
                market_id: market.to_vec(),
            }))
            .await
            .expect("get_book should return snapshot");
        let body = resp.into_inner();
        assert_eq!(body.bids.len(), 1);
        assert_eq!(body.asks.len(), 1);
        assert_eq!(body.bids[0].side, Side::Long as i32);
        assert_eq!(body.asks[0].side, Side::Short as i32);
        assert_eq!(body.sequence_number, 1);
        assert!(body.timestamp_ms > 0);
    }

    #[tokio::test]
    async fn get_book_rejects_non_32byte_market_id() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let err = svc
            .get_book(Request::new(MarketRef {
                market_id: vec![0xAA; 8],
            }))
            .await
            .expect_err("8-byte market_id must reject");
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
    }

    #[tokio::test]
    async fn stream_book_emits_initial_snapshot_then_updates() {
        let state = Arc::new(GrpcState::new());
        let svc = MatcherService::new(state.clone());
        let market = [0x55; 32];

        // Seed one market so the initial snapshot has data.
        state
            .publish_book_snapshot(
                market,
                vec![(1_000_000_000_000_000_000_i128, 2_000_000_000_000_000_000u128)],
                vec![],
            )
            .await;

        let resp = svc
            .stream_book(Request::new(BookSubscription {
                market_ids: vec![market.to_vec()],
            }))
            .await
            .expect("subscribe");
        let mut stream = resp.into_inner();

        use tokio_stream::StreamExt as _;
        let initial = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("timeout")
            .expect("end")
            .expect("status");
        assert_eq!(initial.market_id, market.to_vec());
        assert!(initial.snapshot);
        assert_eq!(initial.levels.len(), 1);
        assert_eq!(initial.sequence_number, 1);

        // Publish a new snapshot — the stream should observe it via the broadcast.
        state
            .publish_book_snapshot(
                market,
                vec![(1_050_000_000_000_000_000_i128, 1_000_000_000_000_000_000u128)],
                vec![(1_200_000_000_000_000_000_i128, 800_000_000_000_000_000u128)],
            )
            .await;
        let follow = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("timeout")
            .expect("end")
            .expect("status");
        assert_eq!(follow.sequence_number, 2);
        assert!(follow.snapshot);
        assert_eq!(follow.levels.len(), 2);
    }

    #[test]
    fn extract_book_levels_aggregates_per_price_descending_bids() {
        use bufi_orderbook::{Order, Price, Side as ObSide, Size};
        let mut book = bufi_orderbook::OrderBook::new([0u8; 32]);

        let mk_order = |id_byte: u8, side: ObSide, price: i128, size: u128| Order {
            id: [id_byte; 32],
            trader: [id_byte; 20],
            side,
            price: Price::new(price),
            remaining: Size::new(size),
            flags: 0,
            inserted_at_ms: id_byte as u64,
        };
        book.insert(mk_order(1, ObSide::Long, 100, 50));
        book.insert(mk_order(2, ObSide::Long, 100, 30)); // same level → aggregates
        book.insert(mk_order(3, ObSide::Long, 110, 20));
        book.insert(mk_order(4, ObSide::Short, 120, 40));
        book.insert(mk_order(5, ObSide::Short, 130, 10));

        let (bids, asks) = extract_book_levels(&book);
        assert_eq!(bids.len(), 2);
        assert_eq!(bids[0], (110, 20), "best bid first (descending)");
        assert_eq!(bids[1], (100, 80), "two-order level aggregated");
        assert_eq!(asks.len(), 2);
        assert_eq!(asks[0], (120, 40), "best ask first (ascending)");
        assert_eq!(asks[1], (130, 10));
    }

    #[tokio::test]
    async fn stream_trades_filters_by_market_ids() {
        use bufi_orderbook::{Fill, Price, Side as ObSide, Size};
        let state = Arc::new(GrpcState::new());
        let svc = MatcherService::new(state.clone());

        let target_market = vec![0xAA; 32];
        let other_market = vec![0xBB; 32];

        let stream_resp = svc
            .stream_trades(Request::new(TradeSubscription {
                market_ids: vec![target_market.clone()],
            }))
            .await
            .expect("subscribe should succeed");
        let mut stream = stream_resp.into_inner();

        let mk_fill = |market: [u8; 32]| Fill {
            fill_id: [0; 32],
            maker_intent_id: [0; 32],
            taker_intent_id: [0; 32],
            market_id: market,
            taker_side: ObSide::Long,
            price: Price::new(1),
            size: Size::new(1),
            timestamp_ms: 0,
            is_lp_fill: false,
        };
        // Publish other, then target — only target should arrive.
        state.publish_trade(fill_to_proto_trade(&mk_fill([0xBB; 32]), 0, 0, false));
        state.publish_trade(fill_to_proto_trade(&mk_fill([0xAA; 32]), 0, 0, false));

        use tokio_stream::StreamExt as _;
        let received = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("timeout")
            .expect("stream ended")
            .expect("status error");
        assert_eq!(received.market_id, target_market);
        // Sanity: the other_market message was filtered out, not just delayed.
        let _ = other_market;
    }

    // ---------------------------------------------------------------
    // Phase 8d — submit/cancel helper tests
    // ---------------------------------------------------------------

    use alloy_signer::SignerSync;
    use alloy_signer_local::PrivateKeySigner;
    use bufi_perps_onchain::deployment::LiquidationParams;
    use bufi_perps_onchain::{PerpsContracts, PerpsDeployment};

    fn fake_deployment() -> PerpsDeployment {
        PerpsDeployment {
            chain_id: 5_042_002,
            deployer: Address::ZERO,
            keeper: Address::ZERO,
            contracts: PerpsContracts {
                fx_order_settlement: Address::ZERO,
                fx_perp_clearinghouse: Address::ZERO,
                fx_funding_engine: Address::ZERO,
                fx_health_checker: Address::ZERO,
                fx_liquidation_engine: Address::ZERO,
                fx_margin_account: Address::ZERO,
            },
            liquidation: LiquidationParams::default(),
        }
    }

    /// Sign + return a proto SignedOrder ready to round-trip through
    /// parse_and_verify against `fake_deployment()`. Marketing-Id is
    /// caller-supplied so tests can pin specific intents.
    fn signed_proto_order(
        signer: &PrivateKeySigner,
        market_id: [u8; 32],
        size_delta: i128,
        price_e18: u128,
        deadline_secs: u64,
        nonce: u64,
    ) -> SignedOrder {
        let deployment = fake_deployment();
        let domain = eip712_domain(deployment.chain_id, deployment.contracts.fx_order_settlement);
        let typed = TypedSignedOrder {
            trader: signer.address(),
            marketId: B256::from(market_id),
            sizeDeltaE18: I256::try_from(size_delta).unwrap(),
            priceE18: U256::from(price_e18),
            maxFee: U256::ZERO,
            orderType: 1,
            flags: 0,
            nonce,
            deadline: deadline_secs,
        };
        let digest: B256 = typed.eip712_signing_hash(&domain);
        let sig = signer.sign_hash_sync(&digest).expect("sign");
        let mut sig_bytes = Vec::with_capacity(65);
        sig_bytes.extend_from_slice(&sig.r().to_be_bytes::<32>());
        sig_bytes.extend_from_slice(&sig.s().to_be_bytes::<32>());
        sig_bytes.push(if sig.v() { 28 } else { 27 });

        SignedOrder {
            trader: signer.address().as_slice().to_vec(),
            market_id: market_id.to_vec(),
            size_delta_e18: i256_to_be32(size_delta),
            price_e18: u128_to_be32(price_e18),
            max_fee: u128_to_be32(0),
            order_type: ProtoOrderType::Limit as i32,
            flags: 0,
            nonce,
            deadline_secs,
            signature: sig_bytes,
            tif: 0,
            client_tag: String::new(),
        }
    }

    fn i256_to_be32(v: i128) -> Vec<u8> {
        // i128 → i256 → 32B BE. Sign-extend across the upper 16 bytes.
        I256::try_from(v).unwrap().to_be_bytes::<32>().to_vec()
    }

    #[test]
    fn parse_and_verify_round_trips_a_signed_order() {
        let signer = PrivateKeySigner::random();
        let market = [0x42u8; 32];
        let proto = signed_proto_order(&signer, market, 1_000_000_000_000_000_000, 5, 9_999_999_999, 1);
        let parsed = parse_and_verify(&proto, &fake_deployment()).expect("verify");
        assert_eq!(parsed.trader, signer.address());
        assert_eq!(parsed.typed.nonce, 1);
        assert_eq!(parsed.typed.deadline, 9_999_999_999);
        // Intent id is deterministic from the EIP-712 hash — same
        // request twice gives the same id.
        let parsed2 = parse_and_verify(&proto, &fake_deployment()).expect("verify");
        assert_eq!(parsed.intent_id, parsed2.intent_id);
    }

    #[test]
    fn parse_and_verify_rejects_zero_size() {
        let signer = PrivateKeySigner::random();
        let proto = signed_proto_order(&signer, [0u8; 32], 0, 1, 9_999_999_999, 1);
        let err = parse_and_verify(&proto, &fake_deployment()).expect_err("zero size");
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
        assert!(err.message().contains("nonzero"));
    }

    #[test]
    fn parse_and_verify_rejects_signature_signed_by_other_key() {
        let real = PrivateKeySigner::random();
        let imposter = PrivateKeySigner::random();
        // Build the proto by signing with `imposter`, then rewrite
        // the trader bytes to `real`'s address — sigVerify should
        // catch the mismatch and reject.
        let mut proto =
            signed_proto_order(&imposter, [0u8; 32], 1_000, 1, 9_999_999_999, 1);
        proto.trader = real.address().as_slice().to_vec();
        let err = parse_and_verify(&proto, &fake_deployment()).expect_err("must reject");
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
        assert!(err.message().contains("recovers"));
    }

    #[test]
    fn parse_and_verify_rejects_wrong_field_lengths() {
        // 19-byte trader (one short of an address) must reject.
        let signer = PrivateKeySigner::random();
        let mut proto = signed_proto_order(&signer, [0u8; 32], 1, 1, 9_999_999_999, 1);
        proto.trader = vec![0u8; 19];
        let err = parse_and_verify(&proto, &fake_deployment()).expect_err("bad trader");
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
        assert!(err.message().contains("20 bytes"));
    }

    #[tokio::test]
    async fn cancel_order_returns_not_found_for_unknown_intent() {
        use bufi_perps_db::PerpsDb;
        let state = Arc::new(GrpcState::new());
        let db = PerpsDb::open_in_memory().await.expect("open in-memory db");
        let onchain = bufi_perps_onchain::PerpsOnchain::new(
            "http://127.0.0.1:0",
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            fake_deployment(),
        )
        .expect("build PerpsOnchain");
        let svc = MatcherService::with_chain(
            state,
            ChainBackend {
                db,
                onchain,
                deployment: fake_deployment(),
                chain_id: 5_042_002,
            },
        );
        let resp = svc
            .cancel_order(Request::new(IntentRef {
                intent_id: vec![0xDE; 32],
                market_id: vec![0xAB; 32],
            }))
            .await
            .expect("cancel should succeed for not-found");
        let body = resp.into_inner();
        assert_eq!(body.status, CancelStatus::NotFound as i32);
        assert_eq!(body.residual_size, vec![0u8; 32]);
    }

    #[tokio::test]
    async fn cancel_order_marks_pending_intent_canceled_with_residual() {
        use bufi_perps_db::PerpsDb;
        let state = Arc::new(GrpcState::new());
        let db = PerpsDb::open_in_memory().await.expect("open in-memory db");
        let onchain = bufi_perps_onchain::PerpsOnchain::new(
            "http://127.0.0.1:0",
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            fake_deployment(),
        )
        .expect("build PerpsOnchain");

        // Seed one pending intent.
        let size_delta_e18: i128 = 2_000_000_000_000_000_000; // 2.0
        let intent_id_hex =
            "0xabababababababababababababababababababababababababababababababab".to_string();
        let row = PerpIntent {
            intent_id: intent_id_hex.clone(),
            replacement_of: None,
            chain_id: 5_042_002,
            trader: "0x0000000000000000000000000000000000000001".to_string(),
            market_id:
                "0x0000000000000000000000000000000000000000000000000000000000000042".to_string(),
            side: PerpSide::Long,
            size_usdc: "0".to_string(),
            size_delta: size_delta_e18.to_string(),
            filled_size_delta: "0".to_string(),
            remaining_size_delta: size_delta_e18.to_string(),
            leverage: 1,
            order_type: PerpOrderType::Limit,
            price_e18: "1000000000000000000".to_string(),
            limit_price: None,
            reduce_only: false,
            post_only: false,
            flags: 0,
            digest: intent_id_hex.clone(),
            signature: "0x".to_string() + &"00".repeat(65),
            nonce: "1".to_string(),
            deadline: 9_999_999_999,
            status: PerpIntentStatus::Pending,
            created_at: 0,
            updated_at: 0,
        };
        db.put(&row).await.expect("seed");

        let svc = MatcherService::with_chain(
            state,
            ChainBackend {
                db: db.clone(),
                onchain,
                deployment: fake_deployment(),
                chain_id: 5_042_002,
            },
        );

        let mut intent_id_bytes = [0u8; 32];
        intent_id_bytes.copy_from_slice(
            &alloy_primitives::hex::decode(intent_id_hex.trim_start_matches("0x"))
                .expect("hex decode"),
        );
        let resp = svc
            .cancel_order(Request::new(IntentRef {
                intent_id: intent_id_bytes.to_vec(),
                market_id: vec![0x42; 32],
            }))
            .await
            .expect("cancel should succeed");
        let body = resp.into_inner();
        assert_eq!(body.status, CancelStatus::Canceled as i32);
        // Residual_size is the full 2e18 magnitude as 32-byte BE u256.
        let expected = u128_to_be32(2_000_000_000_000_000_000);
        assert_eq!(body.residual_size, expected);

        // Confirm DB row is now Canceled.
        let post = db.get(&intent_id_hex).await.expect("re-read").expect("row");
        assert_eq!(post.status, PerpIntentStatus::Canceled);
    }
}
