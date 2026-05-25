//! Phase 8.5a — HTTP /health + /ready + /metrics on a separate port
//! from the tonic gRPC server.
//!
//! Why a second port? tonic on :3005 is HTTP/2 prior-knowledge — k8s
//! liveness probes, Datadog agents, Prometheus scrapers, and most
//! cloud LB health checks speak vanilla HTTP/1.1. Running axum on
//! :3006 keeps both audiences happy without negotiating ALPN.
//!
//! ## Endpoints
//!
//! * `GET /health` — liveness. Always returns 200 with `{status, version,
//!   uptime_seconds}`. Used by container orchestrators that just want
//!   "is the process up?" Cheap, no I/O.
//!
//! * `GET /ready` — readiness. Returns 200 with `{ready: true, ...}`
//!   if: (a) the DB pool can answer `SELECT 1`, AND (b) `last_tick_ms`
//!   is within `ready_max_tick_age` of now (or uptime <
//!   ready_max_tick_age — fresh-boot exemption). Returns 503
//!   otherwise. Used by load balancers + canary keepers to decide
//!   whether to send traffic.
//!
//! * `GET /metrics` — Prometheus exposition. Exposes the same hot
//!   counters as the gRPC `Health` RPC (uptime, match_sequence_number,
//!   last_fill_timestamp_ms, last_tick_ms) plus a derived
//!   `tick_age_seconds` gauge that's easier to alert on than the raw
//!   millis timestamp.
//!
//! ## Why pull state from `Arc<GrpcState>`
//!
//! The gRPC server is the canonical owner of these counters. By
//! sharing the same Arc we get one source of truth — the HTTP
//! responses are guaranteed identical to what the gRPC `Health` RPC
//! would return. No drift, no double-bookkeeping.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::SystemTime;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use bufi_perps_db::PerpsDb;
use serde_json::json;
use tracing::warn;

use crate::grpc::GrpcState;

/// Shared state the HTTP router reads from. Lightweight wrapper —
/// `grpc` is shared by reference with the tonic server (same Arc),
/// `db` is cloned (PerpsDb is a SqlitePool handle, cheap to clone).
#[derive(Clone)]
pub struct HttpHealthState {
    pub grpc: Arc<GrpcState>,
    pub db: PerpsDb,
    /// Cargo package version, surfaced in /health for ops trace-back.
    pub version: &'static str,
    /// Max age of `last_tick_ms` before /ready returns 503. Default
    /// 2 × tick_idle from config.
    pub ready_max_tick_age_ms: u64,
}

/// Build the router. Pure construction — caller decides when + where
/// to serve it (`serve()` below is a thin convenience).
pub fn router(state: HttpHealthState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/metrics", get(metrics))
        .with_state(state)
}

/// Bind + serve on the given address. Returns only on listener error
/// or graceful shutdown — caller wraps in a `tokio::spawn` and adds
/// the join handle to `tokio::select!`.
pub async fn serve(
    addr: std::net::SocketAddr,
    state: HttpHealthState,
) -> std::io::Result<()> {
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Liveness probe. Always returns 200 — answers "is the process up?"
/// Don't add I/O here; the goal is to be cheap enough that a probe
/// every second is fine.
async fn health(State(s): State<HttpHealthState>) -> Json<serde_json::Value> {
    let uptime = s.grpc.started_at.elapsed().as_secs();
    Json(json!({
        "status": "ok",
        "version": s.version,
        "uptime_seconds": uptime,
    }))
}

/// Readiness probe. Returns 200 only if the matcher can do real work
/// (DB queryable + tick loop active). 503 otherwise so load balancers
/// stop routing traffic to a stalled instance.
async fn ready(State(s): State<HttpHealthState>) -> Response {
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // DB check — cheapest possible: SELECT 1 against the pool.
    let db_ok = sqlx::query("SELECT 1")
        .execute(s.db.pool())
        .await
        .is_ok();

    // Tick freshness check — has the loop fired recently? Fresh-boot
    // exemption: if uptime < ready_max_tick_age, accept zero
    // last_tick_ms (the first tick hasn't landed yet).
    let last_tick_ms = s.grpc.last_tick_ms.load(Ordering::Relaxed);
    let uptime_ms = s.grpc.started_at.elapsed().as_millis() as u64;
    let tick_ok = if uptime_ms < s.ready_max_tick_age_ms {
        true
    } else {
        last_tick_ms > 0
            && now_ms.saturating_sub(last_tick_ms) < s.ready_max_tick_age_ms
    };

    let ready = db_ok && tick_ok;
    let status = if ready {
        StatusCode::OK
    } else {
        warn!(db_ok, tick_ok, last_tick_ms, "matcher not ready");
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(json!({
            "ready": ready,
            "db": db_ok,
            "tick": tick_ok,
            "last_tick_ms": last_tick_ms,
            "now_ms": now_ms,
        })),
    )
        .into_response()
}

/// Prometheus exposition. Plain text, `text/plain; version=0.0.4`.
/// All counters monotonic (use `counter` type), timestamps + ages
/// are gauges.
async fn metrics(State(s): State<HttpHealthState>) -> impl IntoResponse {
    let uptime = s.grpc.started_at.elapsed().as_secs();
    let match_seq = s.grpc.match_sequence_number.load(Ordering::Relaxed);
    let last_fill_ms = s.grpc.last_fill_timestamp_ms.load(Ordering::Relaxed);
    let last_tick_ms = s.grpc.last_tick_ms.load(Ordering::Relaxed);
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let tick_age_seconds = if last_tick_ms == 0 {
        0
    } else {
        now_ms.saturating_sub(last_tick_ms) / 1_000
    };
    let fill_age_seconds = if last_fill_ms == 0 {
        0
    } else {
        now_ms.saturating_sub(last_fill_ms) / 1_000
    };

    let body = format!(
        "# HELP bufi_matcher_uptime_seconds Process uptime in seconds.\n\
         # TYPE bufi_matcher_uptime_seconds counter\n\
         bufi_matcher_uptime_seconds {uptime}\n\
         \n\
         # HELP bufi_matcher_match_sequence Tick loop iteration counter (monotonic).\n\
         # TYPE bufi_matcher_match_sequence counter\n\
         bufi_matcher_match_sequence {match_seq}\n\
         \n\
         # HELP bufi_matcher_last_fill_timestamp_ms Unix millis of last successful settleMatch.\n\
         # TYPE bufi_matcher_last_fill_timestamp_ms gauge\n\
         bufi_matcher_last_fill_timestamp_ms {last_fill_ms}\n\
         \n\
         # HELP bufi_matcher_last_tick_timestamp_ms Unix millis of last completed tick.\n\
         # TYPE bufi_matcher_last_tick_timestamp_ms gauge\n\
         bufi_matcher_last_tick_timestamp_ms {last_tick_ms}\n\
         \n\
         # HELP bufi_matcher_tick_age_seconds Seconds since last completed tick.\n\
         # TYPE bufi_matcher_tick_age_seconds gauge\n\
         bufi_matcher_tick_age_seconds {tick_age_seconds}\n\
         \n\
         # HELP bufi_matcher_fill_age_seconds Seconds since last successful fill (0 if no fill yet).\n\
         # TYPE bufi_matcher_fill_age_seconds gauge\n\
         bufi_matcher_fill_age_seconds {fill_age_seconds}\n"
    );
    (
        [("content-type", "text/plain; version=0.0.4")],
        body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;
    use tower::ServiceExt;

    async fn make_state() -> HttpHealthState {
        let grpc = Arc::new(GrpcState::new());
        let db = PerpsDb::open_in_memory().await.expect("db");
        HttpHealthState {
            grpc,
            db,
            version: "test",
            ready_max_tick_age_ms: 60_000,
        }
    }

    #[tokio::test]
    async fn health_always_200_with_version() {
        let state = make_state().await;
        let app = router(state);
        let resp = app
            .oneshot(Request::builder().uri("/health").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["version"], "test");
        assert!(json["uptime_seconds"].as_u64().is_some());
    }

    #[tokio::test]
    async fn ready_returns_200_on_fresh_boot_before_first_tick() {
        // Fresh boot exemption: zero last_tick_ms is OK if uptime <
        // ready_max_tick_age (we haven't given the tick loop a chance
        // to fire yet).
        let state = make_state().await;
        let app = router(state);
        let resp = app
            .oneshot(Request::builder().uri("/ready").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn ready_returns_503_when_tick_is_stale() {
        let mut state = make_state().await;
        // Tighten the threshold so the test doesn't need to actually
        // wait. uptime > threshold but last_tick_ms still 0 → not
        // ready.
        state.ready_max_tick_age_ms = 1;
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let app = router(state);
        let resp = app
            .oneshot(Request::builder().uri("/ready").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn ready_returns_200_when_tick_is_recent() {
        let state = make_state().await;
        // Simulate a recent tick.
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        state.grpc.last_tick_ms.store(now_ms, Ordering::Relaxed);
        let app = router(state);
        let resp = app
            .oneshot(Request::builder().uri("/ready").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["ready"], true);
        assert_eq!(json["db"], true);
        assert_eq!(json["tick"], true);
    }

    #[tokio::test]
    async fn metrics_exposes_prometheus_lines() {
        let state = make_state().await;
        state.grpc.match_sequence_number.store(42, Ordering::Relaxed);
        let app = router(state);
        let resp = app
            .oneshot(Request::builder().uri("/metrics").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 8192).await.unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("# HELP bufi_matcher_uptime_seconds"));
        assert!(text.contains("# TYPE bufi_matcher_match_sequence counter"));
        assert!(text.contains("bufi_matcher_match_sequence 42"));
        assert!(text.contains("bufi_matcher_last_tick_timestamp_ms 0"));
    }
}
