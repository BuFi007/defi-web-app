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
    IntentRef, MarketRef, MatchResult, SignedOrder, Trade, TradeSubscription,
};
use tokio_stream::Stream;
use tonic::{Request, Response, Status};

/// Shared state the gRPC service reads from. Each future field is a
/// hook for the next sub-phase — kept here so the trait impl below
/// only needs to read state, never plumb anything new on each phase.
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
}

impl GrpcState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            match_sequence_number: 0.into(),
            last_fill_timestamp_ms: 0.into(),
        }
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
        _req: Request<TradeSubscription>,
    ) -> Result<Response<Self::StreamTradesStream>, Status> {
        Err(Status::unimplemented(
            "StreamTrades lands in Phase 8b (broadcast channel tap on \
             settle_one). Use the API's SSE stream at \
             `GET /perps/intents/:id/stream` for intent-scoped status \
             today, or the matcher's tracing log for the firehose.",
        ))
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
}
