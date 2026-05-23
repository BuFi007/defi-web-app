//! Phase 8 — tonic gRPC server over `proto/matcher.v1.proto`.
//!
//! This module hosts the matcher's external read+write surface for
//! latency-sensitive clients that don't want to round-trip through
//! `apps/api` over HTTP. Bind address comes from `MATCHER_GRPC_BIND`
//! (default `127.0.0.1:3005` — loopback only). Set to empty to disable.
//!
//! ## Surface (Phase 8a — this commit)
//!
//! Foundation only. The full `Matcher` trait is implemented but every
//! RPC except `Health` returns `Unimplemented` with a clear message
//! pointing at the HTTP API (`apps/api`) for clients that need the
//! behaviour today. Phases 8b-8d fill in:
//!   - 8b: `StreamTrades` via a tokio broadcast tapped from `settle_one`
//!   - 8c: `GetBook` + `StreamBook` via shared OrderBook state
//!   - 8d: `SubmitOrder` + `CancelOrder` via synchronous in-thread match
//!
//! Keeping the trait fully populated from day one means clients can
//! generate stubs against the canonical proto immediately and just
//! gracefully handle `UNIMPLEMENTED` for the not-yet-built RPCs.

use std::time::Instant;

use bufi_matcher_types::proto::matcher::v1::{
    health_response::Status as HealthStatus,
    matcher_server::{Matcher as MatcherSvc, MatcherServer},
    BookSnapshot, BookSubscription, BookUpdate, CancelResult, HealthRequest, HealthResponse,
    IntentRef, MarketRef, MatchResult, Side, SignedOrder, Trade, TradeSubscription,
};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tonic::{Request, Response, Status};

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
    /// Phase 8b — every successful `settle_one` builds a `Trade` proto
    /// and sends it here. `StreamTrades` subscribers read from this
    /// channel. Bounded so a slow client can't grow memory; the
    /// `BroadcastStream` adapter surfaces `Lagged` errors which the
    /// stream handler converts into a tonic `Status` (clients
    /// reconnect on lag).
    pub trade_tx: broadcast::Sender<Trade>,
}

impl GrpcState {
    pub fn new() -> Self {
        // Capacity 256 — at the matcher's 1-30s tick cadence and even
        // pessimistic 10 fills/tick, a client has ~25s before lag at
        // the steepest cadence. Plenty for a UI; not so big it grows
        // memory under back-pressure.
        let (trade_tx, _) = broadcast::channel(256);
        Self {
            started_at: Instant::now(),
            match_sequence_number: 0.into(),
            last_fill_timestamp_ms: 0.into(),
            trade_tx,
        }
    }

    /// Convenience for the settlement layer — fire-and-forget. Returns
    /// the count of currently-subscribed receivers (informational).
    pub fn publish_trade(&self, trade: Trade) -> usize {
        self.trade_tx.send(trade).unwrap_or(0)
    }
}

/// The tonic service implementation. Holds an `Arc<GrpcState>` so
/// multiple clones (one per inbound connection) share the same hot
/// counters without contention.
pub struct MatcherService {
    state: std::sync::Arc<GrpcState>,
}

impl MatcherService {
    pub fn new(state: std::sync::Arc<GrpcState>) -> Self {
        Self { state }
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
        _req: Request<SignedOrder>,
    ) -> Result<Response<MatchResult>, Status> {
        // Phase 8d — wires through intent_translator + match_intent.
        // Until then, point callers at the existing HTTP path.
        Err(Status::unimplemented(
            "SubmitOrder lands in Phase 8d. Use `POST /perps/intents` on \
             apps/api today (same wire-format SignedOrder + session-signed \
             request headers).",
        ))
    }

    async fn cancel_order(
        &self,
        _req: Request<IntentRef>,
    ) -> Result<Response<CancelResult>, Status> {
        Err(Status::unimplemented(
            "CancelOrder lands in Phase 8d alongside SubmitOrder. Today \
             cancellations come from the on-chain OrderCancelled event \
             (Permit2 nonce burn) the matcher's event_subscriber picks up.",
        ))
    }

    async fn get_book(
        &self,
        _req: Request<MarketRef>,
    ) -> Result<Response<BookSnapshot>, Status> {
        Err(Status::unimplemented(
            "GetBook lands in Phase 8c (shared OrderBook state). Use \
             `GET /perps/intents/pending?marketId=...` on apps/api today.",
        ))
    }

    type StreamBookStream = BoxStream<BookUpdate>;
    async fn stream_book(
        &self,
        _req: Request<BookSubscription>,
    ) -> Result<Response<Self::StreamBookStream>, Status> {
        Err(Status::unimplemented(
            "StreamBook lands in Phase 8c (shared OrderBook state).",
        ))
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
    async fn submit_order_returns_unimplemented_with_pointer() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let err = svc
            .submit_order(Request::new(SignedOrder::default()))
            .await
            .expect_err("must be Unimplemented");
        assert_eq!(err.code(), tonic::Code::Unimplemented);
        assert!(err.message().contains("Phase 8d"));
        assert!(err.message().contains("POST /perps/intents"));
    }

    #[tokio::test]
    async fn get_book_returns_unimplemented_with_pointer() {
        let svc = MatcherService::new(Arc::new(GrpcState::new()));
        let err = svc
            .get_book(Request::new(MarketRef::default()))
            .await
            .expect_err("must be Unimplemented");
        assert_eq!(err.code(), tonic::Code::Unimplemented);
        assert!(err.message().contains("Phase 8c"));
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
}
