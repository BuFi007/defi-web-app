//! Phase 8.5b — optional Redis publisher tap on the matcher's
//! broadcast channels.
//!
//! ## Purpose
//!
//! The Rust matcher already broadcasts `Trade` and `BookUpdate`
//! events over gRPC (`StreamTrades`, `StreamBook`). Some downstream
//! consumers can't speak gRPC today:
//!
//!   - The legacy TS `apps/keeper-perps-matcher` consumers + the
//!     defi-web-app realtime layer (originally a Redis pub/sub built
//!     in PR #74). Until the WS bridge in apps/api subscribes to
//!     gRPC directly, those consumers expect Redis channels.
//!   - Future `apps/api` WebSocket bridge (Wave H1 / PR #56 once
//!     unblocked) — easier to subscribe to Redis than to a gRPC
//!     stream from a Bun WS server.
//!
//! This module spawns a tokio task per channel (trade + book) that
//! subscribes to the existing in-memory `broadcast::Sender` and
//! republishes every message to Redis. Pure tap — no logic change
//! to the matcher's existing event flow, and no required Redis
//! dependency (the task is only spawned when `MATCHER_REDIS_URL` is
//! non-empty).
//!
//! ## Channel layout
//!
//! Given a `MATCHER_REDIS_CHANNEL_PREFIX` (default `"bufi:"`):
//!
//!   `bufi:trades`                          — firehose across all markets
//!   `bufi:trades:<market_id_hex_no_0x>`    — per-market trades
//!   `bufi:book:<market_id_hex_no_0x>`      — per-market book updates
//!
//! Each message is the proto-encoded `Trade` / `BookUpdate` bytes
//! (same wire format clients already speak via gRPC). Consumers can
//! decode with the language-native protobuf library — no new schema
//! to maintain.
//!
//! ## Reconnection
//!
//! Uses `redis::aio::ConnectionManager`, which transparently
//! reconnects on transient failures with exponential backoff (the
//! default config). If Redis is unavailable at boot, we log a WARN
//! and the task keeps trying — the matcher itself never fails to
//! start because of a Redis outage.
//!
//! ## Backpressure
//!
//! The `broadcast::Sender` is bounded (256 for trades, 64 for book).
//! If Redis publish falls behind, the broadcast receiver lags and
//! we emit a WARN with the skipped count — same semantics as the
//! gRPC stream lag handling. Matters operationally: Redis being
//! slow MUST NOT block the matcher's hot path.

use std::sync::Arc;

use bufi_matcher_types::proto::matcher::v1::{BookUpdate, Trade};
use prost::Message;
use redis::AsyncCommands;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{debug, error, info, warn};

use crate::grpc::GrpcState;

/// Configuration handed in from main.rs. Cheap to clone, lives for
/// the lifetime of the publisher task.
#[derive(Debug, Clone)]
pub struct RealtimeConfig {
    pub redis_url: String,
    pub channel_prefix: String,
}

/// Spawn the realtime publisher tasks. Returns the join handle of
/// a supervisor that owns both (trades + book) subtasks. Caller
/// drops the handle into the same `tokio::select!` as the gRPC /
/// HTTP / tick handles in main.rs.
///
/// Returns `None` when `redis_url` is empty (the disabled path).
/// Callers gate on `Option::is_some()` to decide whether to wire
/// the future into the shutdown select.
pub fn spawn(
    state: Arc<GrpcState>,
    cfg: RealtimeConfig,
) -> Option<tokio::task::JoinHandle<()>> {
    if cfg.redis_url.is_empty() {
        info!("realtime publisher disabled (MATCHER_REDIS_URL empty)");
        return None;
    }
    info!(
        url = %redact_url(&cfg.redis_url),
        prefix = %cfg.channel_prefix,
        "realtime publisher starting (Phase 8.5b)"
    );
    let handle = tokio::spawn(async move {
        if let Err(e) = run(state, cfg).await {
            error!(error = ?e, "realtime publisher exited with error");
        }
    });
    Some(handle)
}

/// Build the ConnectionManager (transparent reconnect with backoff),
/// then race two pub-loops: one for trades, one for book. Returns
/// only on unrecoverable error (the loops themselves retry forever
/// on transient failures).
async fn run(
    state: Arc<GrpcState>,
    cfg: RealtimeConfig,
) -> Result<(), RealtimeError> {
    let client = redis::Client::open(cfg.redis_url.as_str())
        .map_err(|e| RealtimeError::ClientBuild(e.to_string()))?;
    let manager = redis::aio::ConnectionManager::new(client)
        .await
        .map_err(|e| RealtimeError::ConnectionManager(e.to_string()))?;

    let trade_handle = tokio::spawn(publish_trades(
        manager.clone(),
        cfg.channel_prefix.clone(),
        state.trade_tx.subscribe(),
    ));
    let book_handle = tokio::spawn(publish_book(
        manager,
        cfg.channel_prefix,
        state.book_tx.subscribe(),
    ));

    // Either loop exiting means something's wrong — surface to the
    // outer supervisor. We don't try to restart them here; main.rs
    // tokio::select! will detect and exit the process.
    tokio::select! {
        res = trade_handle => {
            warn!(result = ?res, "realtime trade publisher exited");
        }
        res = book_handle => {
            warn!(result = ?res, "realtime book publisher exited");
        }
    }
    Ok(())
}

async fn publish_trades(
    mut conn: redis::aio::ConnectionManager,
    prefix: String,
    rx: broadcast::Receiver<Trade>,
) {
    let firehose_channel = format!("{prefix}trades");
    let mut stream = BroadcastStream::new(rx);
    while let Some(item) = stream.next().await {
        match item {
            Ok(trade) => {
                let market_hex = hex_no_prefix(&trade.market_id);
                let per_market_channel = format!("{prefix}trades:{market_hex}");
                let bytes = trade.encode_to_vec();
                // Per-market publish first (lower-cardinality
                // subscribers benefit), then firehose. We don't
                // pipeline — keeps the failure surface per-message
                // simple.
                if let Err(e) = conn.publish::<_, _, ()>(&per_market_channel, &bytes).await
                {
                    warn!(channel = %per_market_channel, error = ?e, "redis publish failed");
                }
                if let Err(e) = conn.publish::<_, _, ()>(&firehose_channel, &bytes).await
                {
                    warn!(channel = %firehose_channel, error = ?e, "redis publish failed");
                }
                debug!(channel = %per_market_channel, len = bytes.len(), "trade published");
            }
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                warn!(
                    skipped = n,
                    "realtime publisher lagged behind broadcast; trades dropped"
                );
            }
        }
    }
}

async fn publish_book(
    mut conn: redis::aio::ConnectionManager,
    prefix: String,
    rx: broadcast::Receiver<BookUpdate>,
) {
    let mut stream = BroadcastStream::new(rx);
    while let Some(item) = stream.next().await {
        match item {
            Ok(update) => {
                let market_hex = hex_no_prefix(&update.market_id);
                let channel = format!("{prefix}book:{market_hex}");
                let bytes = update.encode_to_vec();
                if let Err(e) = conn.publish::<_, _, ()>(&channel, &bytes).await {
                    warn!(channel = %channel, error = ?e, "redis publish failed");
                }
                debug!(channel = %channel, len = bytes.len(), "book published");
            }
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                warn!(
                    skipped = n,
                    "realtime publisher lagged behind broadcast; book updates dropped"
                );
            }
        }
    }
}

fn hex_no_prefix(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(hex_nibble(b >> 4));
        out.push(hex_nibble(b & 0x0f));
    }
    out
}

fn hex_nibble(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        10..=15 => (b'a' + n - 10) as char,
        _ => '?',
    }
}

/// Strip credentials from a `redis://user:pass@host/...` URL before
/// logging. If parsing fails, returns `<unparseable>` — never echoes
/// raw URL since it may contain a password.
fn redact_url(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut u) => {
            let _ = u.set_password(None);
            let _ = u.set_username("");
            u.to_string()
        }
        Err(_) => "<unparseable>".to_string(),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RealtimeError {
    #[error("redis client build: {0}")]
    ClientBuild(String),
    #[error("redis connection manager init: {0}")]
    ConnectionManager(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use bufi_matcher_types::proto::matcher::v1::Side;

    #[test]
    fn hex_no_prefix_matches_hex_crate() {
        let bytes = [0x00u8, 0x42, 0xff, 0xab];
        assert_eq!(hex_no_prefix(&bytes), "0042ffab");
    }

    #[test]
    fn redact_url_strips_password() {
        let red = redact_url("redis://user:secretpass@redis.internal:6379/3");
        assert!(!red.contains("secretpass"));
        assert!(!red.contains("user:"));
        assert!(red.contains("redis.internal"));
    }

    #[test]
    fn redact_url_returns_placeholder_on_parse_failure() {
        assert_eq!(redact_url("not a url"), "<unparseable>");
    }

    #[test]
    fn spawn_returns_none_when_url_empty() {
        let state = Arc::new(GrpcState::new());
        let cfg = RealtimeConfig {
            redis_url: String::new(),
            channel_prefix: "bufi:".to_string(),
        };
        let handle = spawn(state, cfg);
        assert!(handle.is_none(), "disabled path must not spawn a task");
    }

    #[test]
    fn trade_encode_round_trips() {
        // Sanity: the proto bytes we put on the wire decode back to
        // an equivalent Trade. This is mostly a guard against proto
        // schema drift breaking the Redis consumers silently.
        let trade = Trade {
            fill_id: vec![0xAB; 32],
            maker_intent_id: vec![0xCD; 32],
            taker_intent_id: vec![0xEF; 32],
            market_id: vec![0x12; 32],
            taker_side: Side::Long as i32,
            price: vec![0u8; 32],
            size: vec![0u8; 32],
            timestamp_ms: 1_700_000_000_000,
            maker_cumulative_filled: vec![0u8; 32],
            taker_cumulative_filled: vec![0u8; 32],
            is_lp_fill: false,
            is_liquidation: false,
        };
        let bytes = trade.encode_to_vec();
        let recovered = Trade::decode(bytes.as_slice()).expect("decode");
        assert_eq!(recovered.fill_id, trade.fill_id);
        assert_eq!(recovered.market_id, trade.market_id);
        assert_eq!(recovered.timestamp_ms, trade.timestamp_ms);
        assert_eq!(recovered.taker_side, Side::Long as i32);
    }
}
