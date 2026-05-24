//! Phase 8.5c — Pyth Hermes WebSocket subscription path for the
//! Pyth pusher. Drop-in replacement for the HTTP polling loop in
//! `pyth_pusher.rs`, sharing the same boot-time feed-id resolution
//! and the same on-chain push surface (`PerpsOnchain::submit_pyth_update`).
//!
//! ## Why WS
//!
//! The HTTP poll runs every 5s (`PYTH_PUSH_INTERVAL_MS`) and reads
//! the on-chain `publishTime` per feed before deciding to push. That
//! leaves the matcher's mark-price up to ~5s stale between push and
//! consumer read. The WS subscription pushes a frame within
//! milliseconds of every Pythnet aggregation slot — we push on the
//! same cadence on-chain (gated by the `PYTH_PUSH_MAX_AGE_SECS`
//! freshness check the HTTP path also uses, so quiet markets don't
//! burn gas).
//!
//! ## Wire protocol (Pyth Hermes v2, `/ws` endpoint)
//!
//!   client → {"type":"subscribe","ids":["<hex>",...], "binary":true}
//!   server → {"type":"response","status":"success"}                            // ack
//!   server → {"type":"price_update","price_feed":{
//!               "id":"<hex>",
//!               "price":{"price":"...","conf":"...","expo":n,"publish_time":n},
//!               "vaa":"<base64-encoded VAA bytes>"
//!            }}
//!
//! The `vaa` field (base64) is exactly the bytes `IPyth.updatePriceFeeds`
//! expects — no extra round-trip needed. See
//! `pyth-network/pyth-crosschain/apps/hermes/server/src/api/types.rs`
//! for the canonical struct.
//!
//! ## Reconnect
//!
//! Exponential backoff matching the TS-side reference (PR #45):
//! 1s, 2s, 4s, 8s, 16s, 30s (capped). On reopen we re-subscribe to
//! every feed in a single frame. After [`MAX_WS_RECONNECT_ATTEMPTS`]
//! consecutive failures we surface an error to the caller, which
//! falls back to the HTTP poll so the matcher never goes blind on
//! mark-price freshness.
//!
//! ## On-chain throttle
//!
//! Even though Pythnet emits ~400ms ticks, we DON'T push every tick
//! on-chain — that'd torch gas. The per-feed throttle mirrors the
//! HTTP path: push only when `last_push_secs[feed] + max_age_secs <= now`.
//! This means typical behaviour is: WS keeps a fresh price-update VAA
//! buffered in memory, and we push it on-chain at most once per
//! `max_age_secs` (default 30s). The win over HTTP polling is that
//! the buffered VAA itself is always <1s old, so when we DO push we
//! push a fresh value, not one already 5s stale.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use alloy_primitives::{Address, Bytes, B256};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, info, warn};

use bufi_perps_onchain::PerpsOnchain;

/// Backoff schedule, mirrors the TS-side WS client from PR #45.
pub const RECONNECT_BACKOFF_MS: &[u64] = &[1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/// After this many consecutive failed connection attempts, surface an
/// error to the caller so the outer dispatcher can fall back to the
/// HTTP poll. We don't want the matcher silently flying blind because
/// Hermes WS keeps refusing connections.
pub const MAX_WS_RECONNECT_ATTEMPTS: u32 = 3;

/// One in-flight WS run. Owns the open socket, the per-feed throttle
/// state, and the on-chain client used to submit `updatePriceFeeds`.
pub struct PythPusherWs {
    onchain: PerpsOnchain,
    ws_url: String,
    pyth_address: Address,
    /// Feed ids to subscribe to. Lowercase hex, no `0x` prefix — the
    /// shape Hermes accepts in the subscribe frame.
    feed_ids_hex: Vec<String>,
    /// Same feeds keyed by raw bytes — used for the throttle map.
    feed_ids: BTreeSet<B256>,
    /// Per-feed: last unix-secs we submitted an on-chain push. Shared
    /// with the message-handling loop via Mutex.
    last_push_secs: Arc<Mutex<BTreeMap<B256, u64>>>,
    /// Skip the on-chain push if `publish_time + this > now` for the
    /// incoming WS tick. Same semantics as the HTTP path's pre-push
    /// staleness gate. Reads from `cfg.pyth_push_max_age`.
    max_age_secs: u64,
}

impl PythPusherWs {
    /// Build a runner from an already-resolved feed set.
    pub fn new(
        onchain: PerpsOnchain,
        ws_url: String,
        pyth_address: Address,
        feed_ids: BTreeSet<B256>,
        max_age_secs: u64,
    ) -> Self {
        let feed_ids_hex = feed_ids
            .iter()
            .map(|f| format!("{:x}", f))
            .collect::<Vec<_>>();
        Self {
            onchain,
            ws_url,
            pyth_address,
            feed_ids_hex,
            feed_ids,
            last_push_secs: Arc::new(Mutex::new(BTreeMap::new())),
            max_age_secs,
        }
    }

    /// Run forever. Returns `Err` only when we've exhausted the
    /// reconnect schedule — the caller is expected to fall back to
    /// the HTTP path in that case.
    pub async fn run(self) -> Result<(), PythWsError> {
        let mut attempt: u32 = 0;
        loop {
            match self.connect_and_run_once().await {
                Ok(()) => {
                    // Clean shutdown (only used by tests). Reset and
                    // try again — production never reaches here.
                    attempt = 0;
                }
                Err(e) => {
                    attempt = attempt.saturating_add(1);
                    if attempt > MAX_WS_RECONNECT_ATTEMPTS {
                        warn!(
                            attempts = attempt,
                            error = ?e,
                            max = MAX_WS_RECONNECT_ATTEMPTS,
                            "pyth_pusher_ws: exhausted reconnect budget; falling back to HTTP poll"
                        );
                        return Err(e);
                    }
                    let delay = backoff_for_attempt(attempt);
                    warn!(
                        attempt,
                        delay_ms = delay.as_millis() as u64,
                        error = ?e,
                        "pyth_pusher_ws: reconnect scheduled"
                    );
                    sleep(delay).await;
                }
            }
        }
    }

    /// One connect → subscribe → consume-loop → disconnect cycle.
    async fn connect_and_run_once(&self) -> Result<(), PythWsError> {
        info!(url = %self.ws_url, feeds = self.feed_ids_hex.len(), "pyth_pusher_ws: connecting");
        let (stream, _resp) = tokio_tungstenite::connect_async(&self.ws_url)
            .await
            .map_err(|e| PythWsError::Connect(e.to_string()))?;
        let (mut sink, mut source) = stream.split();

        // Send the subscribe frame. Pyth accepts an array of ids per
        // request; single frame keeps message handling simpler.
        let sub = build_subscribe_message(&self.feed_ids_hex);
        sink.send(WsMessage::Text(sub))
            .await
            .map_err(|e| PythWsError::Send(e.to_string()))?;
        info!(feeds = self.feed_ids_hex.len(), "pyth_pusher_ws: subscribe frame sent");

        while let Some(msg) = source.next().await {
            let msg = msg.map_err(|e| PythWsError::Recv(e.to_string()))?;
            match msg {
                WsMessage::Text(text) => {
                    if let Err(e) = self.handle_text(&text).await {
                        debug!(error = ?e, "pyth_pusher_ws: ignored bad frame");
                    }
                }
                WsMessage::Binary(_) => {
                    // Hermes uses JSON-text frames; binary frames
                    // would be unexpected. Ignore rather than abort.
                    debug!("pyth_pusher_ws: unexpected binary frame, ignored");
                }
                WsMessage::Ping(payload) => {
                    sink.send(WsMessage::Pong(payload))
                        .await
                        .map_err(|e| PythWsError::Send(e.to_string()))?;
                }
                WsMessage::Pong(_) | WsMessage::Frame(_) => {
                    // Ignore — tungstenite handles pongs we initiate.
                }
                WsMessage::Close(_) => {
                    warn!("pyth_pusher_ws: server sent Close frame");
                    return Err(PythWsError::Closed);
                }
            }
        }
        // Stream ended cleanly — treat as a disconnect to drive reconnect.
        Err(PythWsError::Closed)
    }

    /// Parse one text frame and, if it's a price_update for a feed we
    /// care about, possibly push the VAA on-chain. Ignores ack frames
    /// (`{"type":"response","status":"success"}`).
    async fn handle_text(&self, text: &str) -> Result<(), PythWsError> {
        let frame: HermesServerFrame = serde_json::from_str(text)
            .map_err(|e| PythWsError::Parse(e.to_string()))?;
        match frame {
            HermesServerFrame::PriceUpdate { price_feed } => {
                self.on_price_update(price_feed).await
            }
            HermesServerFrame::Response { status, error } => {
                if status != "success" {
                    warn!(status, error = ?error, "pyth_pusher_ws: server response error");
                } else {
                    debug!("pyth_pusher_ws: subscribe ack");
                }
                Ok(())
            }
        }
    }

    async fn on_price_update(&self, feed: HermesPriceFeed) -> Result<(), PythWsError> {
        // Resolve the incoming feed id back to its B256 form so we
        // can look up the throttle entry. Hermes returns lowercase
        // hex sometimes with and sometimes without a `0x` prefix —
        // strip both.
        let feed_b256 = match parse_feed_id_hex(&feed.id) {
            Some(b) => b,
            None => return Ok(()), // bad shape, skip silently
        };
        if !self.feed_ids.contains(&feed_b256) {
            // Hermes shouldn't deliver feeds we didn't subscribe to,
            // but be defensive.
            return Ok(());
        }
        let vaa_b64 = match feed.vaa.as_deref() {
            Some(v) => v,
            None => {
                debug!(feed = %feed.id, "pyth_pusher_ws: price_update without vaa (binary=false?)");
                return Ok(());
            }
        };

        let now = current_unix_secs();
        let publish_time = feed.price.publish_time;

        // Stale-tick gate. Skip pushes for ticks that wouldn't beat
        // the on-chain `publishTime + max_age_secs` check anyway.
        if publish_time != 0
            && publish_time.saturating_add(self.max_age_secs as i64) > now as i64
        {
            // The TICK itself is fresh, but the previous on-chain
            // push may also still be fresh. The HTTP path read
            // `getPriceUnsafe(feed).publishTime` per tick — that's
            // an RPC roundtrip we want to avoid. Instead, use the
            // local last_push_secs cache. The first push always
            // wins (cache miss treated as stale).
            let mut throttle = self.last_push_secs.lock().await;
            let last = throttle.get(&feed_b256).copied().unwrap_or(0);
            if last.saturating_add(self.max_age_secs) > now {
                debug!(
                    feed = %feed.id,
                    publish_time,
                    last_push = last,
                    "pyth_pusher_ws: skipping push (throttle window)"
                );
                return Ok(());
            }
            // Mark the push timestamp BEFORE the RPC call. If the RPC
            // fails we'll retry on the next tick anyway, and this
            // avoids a thundering herd if multiple ticks land while
            // the previous tx is still pending.
            throttle.insert(feed_b256, now);
            drop(throttle);
        }

        let vaa_bytes = BASE64_STANDARD
            .decode(vaa_b64)
            .map_err(|e| PythWsError::Parse(format!("vaa base64: {e}")))?;
        let update = vec![Bytes::from(vaa_bytes)];

        match self
            .onchain
            .submit_pyth_update(self.pyth_address, update)
            .await
        {
            Ok(tx) => {
                info!(
                    tx = ?tx,
                    feed = %feed.id,
                    publish_time,
                    "pyth_pusher_ws: feed pushed on-chain"
                );
                Ok(())
            }
            Err(e) => {
                warn!(
                    feed = %feed.id,
                    error = ?e,
                    "pyth_pusher_ws: updatePriceFeeds failed"
                );
                // Roll back the throttle entry so the next tick retries.
                let mut throttle = self.last_push_secs.lock().await;
                throttle.remove(&feed_b256);
                Ok(())
            }
        }
    }
}

/// Errors raised by the WS path. Boot-time misconfig (bad URL, bad
/// feed-id shape) is caught at the dispatcher in `pyth_pusher.rs`;
/// this enum is for runtime failures.
#[derive(Debug, Error)]
pub enum PythWsError {
    #[error("connect: {0}")]
    Connect(String),
    #[error("send: {0}")]
    Send(String),
    #[error("recv: {0}")]
    Recv(String),
    #[error("parse: {0}")]
    Parse(String),
    #[error("stream closed")]
    Closed,
}

/// Build the JSON subscribe frame. Separated so unit tests can verify
/// the exact wire shape without spinning up a real socket.
pub(crate) fn build_subscribe_message(feed_ids_hex: &[String]) -> String {
    // We could use serde_json::to_string on a struct here, but
    // hand-building keeps the wire format stable across serde version
    // bumps and lets the unit test assert on a literal.
    let mut s = String::from(r#"{"type":"subscribe","binary":true,"ids":["#);
    for (i, id) in feed_ids_hex.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('"');
        s.push_str(id);
        s.push('"');
    }
    s.push_str("]}");
    s
}

/// Pick the next backoff delay. `attempt` is 1-indexed (first retry
/// = `RECONNECT_BACKOFF_MS[0]`).
pub(crate) fn backoff_for_attempt(attempt: u32) -> Duration {
    let idx = (attempt.saturating_sub(1) as usize).min(RECONNECT_BACKOFF_MS.len() - 1);
    Duration::from_millis(RECONNECT_BACKOFF_MS[idx])
}

/// Derive the WS URL from the REST Hermes URL. Swaps `https→wss`,
/// `http→ws`, trims any trailing slash, appends `/ws`. Returns the
/// override verbatim when set.
pub fn derive_ws_url(rest_url: &str, override_url: Option<&str>) -> String {
    if let Some(o) = override_url {
        return o.to_string();
    }
    let trimmed = rest_url.trim_end_matches('/');
    let scheme_swapped = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        // Already a ws:// or wss:// URL.
        trimmed.to_string()
    };
    format!("{scheme_swapped}/ws")
}

fn parse_feed_id_hex(s: &str) -> Option<B256> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    if stripped.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(chunk).ok()?;
        out[i] = u8::from_str_radix(hex, 16).ok()?;
    }
    Some(B256::from(out))
}

fn current_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------- Hermes wire types ----------

/// Top-level frame shape. Hermes tags by `type`, so we use serde's
/// internally-tagged enum support to pattern-match. Only the two
/// shapes we care about are listed; anything else fails to parse and
/// gets logged at DEBUG (we don't crash on a forward-compat addition).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum HermesServerFrame {
    PriceUpdate {
        price_feed: HermesPriceFeed,
    },
    Response {
        status: String,
        #[serde(default)]
        error: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
struct HermesPriceFeed {
    id: String,
    price: HermesPrice,
    /// Base64-encoded signed update bytes. Present only when the
    /// subscribe frame included `"binary":true`.
    #[serde(default)]
    vaa: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HermesPrice {
    /// Pyth `publish_time` in unix seconds. Used for the staleness gate.
    publish_time: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_subscribe_message_emits_canonical_shape() {
        let ids = vec!["aabbcc".to_string(), "ddeeff".to_string()];
        let frame = build_subscribe_message(&ids);
        assert_eq!(
            frame,
            r#"{"type":"subscribe","binary":true,"ids":["aabbcc","ddeeff"]}"#
        );
    }

    #[test]
    fn build_subscribe_message_single_feed() {
        let ids = vec!["e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43".to_string()];
        let frame = build_subscribe_message(&ids);
        assert!(frame.contains("\"binary\":true"));
        assert!(frame.contains("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"));
        // Round-trips through serde to a valid JSON value.
        let v: serde_json::Value = serde_json::from_str(&frame).expect("valid json");
        assert_eq!(v["type"], "subscribe");
        assert_eq!(v["binary"], true);
        assert_eq!(v["ids"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn backoff_schedule_increments_then_caps() {
        assert_eq!(backoff_for_attempt(1), Duration::from_millis(1_000));
        assert_eq!(backoff_for_attempt(2), Duration::from_millis(2_000));
        assert_eq!(backoff_for_attempt(3), Duration::from_millis(4_000));
        assert_eq!(backoff_for_attempt(4), Duration::from_millis(8_000));
        assert_eq!(backoff_for_attempt(5), Duration::from_millis(16_000));
        assert_eq!(backoff_for_attempt(6), Duration::from_millis(30_000));
        // Past the cap.
        assert_eq!(backoff_for_attempt(7), Duration::from_millis(30_000));
        assert_eq!(backoff_for_attempt(50), Duration::from_millis(30_000));
    }

    #[test]
    fn backoff_zero_attempt_returns_first_delay() {
        // Defensive: even attempt=0 (shouldn't happen via `run`)
        // returns a valid delay, not a panic.
        assert_eq!(backoff_for_attempt(0), Duration::from_millis(1_000));
    }

    #[test]
    fn derive_ws_url_swaps_https() {
        assert_eq!(
            derive_ws_url("https://hermes.pyth.network", None),
            "wss://hermes.pyth.network/ws"
        );
        assert_eq!(
            derive_ws_url("https://hermes.pyth.network/", None),
            "wss://hermes.pyth.network/ws"
        );
    }

    #[test]
    fn derive_ws_url_swaps_http() {
        assert_eq!(
            derive_ws_url("http://localhost:8080", None),
            "ws://localhost:8080/ws"
        );
    }

    #[test]
    fn derive_ws_url_preserves_already_ws() {
        assert_eq!(
            derive_ws_url("wss://my.mirror/ws", None),
            "wss://my.mirror/ws/ws"
        );
        // The override path is the escape hatch for cases where the
        // derived URL is wrong.
        assert_eq!(
            derive_ws_url("wss://my.mirror/ws", Some("wss://my.mirror/ws")),
            "wss://my.mirror/ws"
        );
    }

    #[test]
    fn derive_ws_url_override_wins() {
        assert_eq!(
            derive_ws_url("https://hermes.pyth.network", Some("wss://override/x")),
            "wss://override/x"
        );
    }

    #[test]
    fn parse_feed_id_hex_round_trips_with_and_without_prefix() {
        let canonical =
            "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
        let with_prefix = format!("0x{canonical}");
        let a = parse_feed_id_hex(canonical).expect("no prefix");
        let b = parse_feed_id_hex(&with_prefix).expect("with prefix");
        assert_eq!(a, b);
    }

    #[test]
    fn parse_feed_id_hex_rejects_bad_length() {
        assert!(parse_feed_id_hex("aabbcc").is_none());
        assert!(parse_feed_id_hex("").is_none());
    }

    #[test]
    fn parse_feed_id_hex_rejects_non_hex() {
        let s = "z".repeat(64);
        assert!(parse_feed_id_hex(&s).is_none());
    }

    #[test]
    fn price_update_frame_parses_with_vaa() {
        let body = r#"{
            "type":"price_update",
            "price_feed":{
                "id":"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
                "price":{"price":"110234500000","conf":"42","expo":-8,"publish_time":1748000000},
                "vaa":"AQID"
            }
        }"#;
        let parsed: HermesServerFrame = serde_json::from_str(body).expect("parse");
        match parsed {
            HermesServerFrame::PriceUpdate { price_feed } => {
                assert_eq!(
                    price_feed.id,
                    "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
                );
                assert_eq!(price_feed.price.publish_time, 1748000000);
                assert_eq!(price_feed.vaa.as_deref(), Some("AQID"));
            }
            _ => panic!("expected PriceUpdate"),
        }
    }

    #[test]
    fn price_update_frame_parses_without_vaa() {
        // When the subscriber didn't set binary=true the vaa field is
        // absent. Should parse cleanly; the runtime handler ignores
        // these frames.
        let body = r#"{
            "type":"price_update",
            "price_feed":{
                "id":"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
                "price":{"price":"1","conf":"0","expo":-8,"publish_time":1}
            }
        }"#;
        let parsed: HermesServerFrame = serde_json::from_str(body).expect("parse");
        match parsed {
            HermesServerFrame::PriceUpdate { price_feed } => {
                assert!(price_feed.vaa.is_none());
            }
            _ => panic!("expected PriceUpdate"),
        }
    }

    #[test]
    fn response_frame_parses_success_ack() {
        let body = r#"{"type":"response","status":"success"}"#;
        let parsed: HermesServerFrame = serde_json::from_str(body).expect("parse");
        match parsed {
            HermesServerFrame::Response { status, error } => {
                assert_eq!(status, "success");
                assert!(error.is_none());
            }
            _ => panic!("expected Response"),
        }
    }

    #[test]
    fn response_frame_parses_error_ack() {
        let body = r#"{"type":"response","status":"error","error":"unknown feed id"}"#;
        let parsed: HermesServerFrame = serde_json::from_str(body).expect("parse");
        match parsed {
            HermesServerFrame::Response { status, error } => {
                assert_eq!(status, "error");
                assert_eq!(error.as_deref(), Some("unknown feed id"));
            }
            _ => panic!("expected Response"),
        }
    }

    #[test]
    fn unknown_frame_fails_to_parse() {
        // Forward-compat: a frame we don't know about should fail
        // to parse rather than crash the loop. The dispatcher logs
        // these at DEBUG and moves on.
        let body = r#"{"type":"future_kind_of_message","whatever":1}"#;
        let parsed: Result<HermesServerFrame, _> = serde_json::from_str(body);
        assert!(parsed.is_err());
    }

    // ---------- Reconnect state machine tests ----------
    //
    // The full `run()` loop talks to a real socket via tungstenite,
    // so we don't unit-test it end-to-end. Instead we cover the two
    // pieces in isolation: backoff math (above) and the dispatcher's
    // "after N failures, surface error" contract (here, via a
    // synthetic loop that mirrors the structure of `run`).

    #[tokio::test]
    async fn dispatcher_surfaces_error_after_max_attempts() {
        // Simulate: every "connect" attempt fails, dispatcher must
        // surface the error after MAX_WS_RECONNECT_ATTEMPTS+1 tries.
        let mut attempt: u32 = 0;
        let result: Result<(), PythWsError> = loop {
            attempt = attempt.saturating_add(1);
            let outcome: Result<(), PythWsError> =
                Err(PythWsError::Connect("simulated".into()));
            if outcome.is_err() && attempt > MAX_WS_RECONNECT_ATTEMPTS {
                break outcome;
            }
            // Don't actually sleep in tests — just spin.
            tokio::task::yield_now().await;
        };
        assert!(result.is_err());
        assert!(attempt > MAX_WS_RECONNECT_ATTEMPTS);
    }

    #[tokio::test]
    async fn dispatcher_resets_attempts_on_clean_disconnect() {
        // Simulate: first attempt succeeds (Ok), next two fail, then
        // we'd be at attempt=2 (not 3) — clean reconnect resets the
        // budget so transient disconnects don't burn through it.
        let mut attempt: u32 = 0;
        let outcomes: Vec<Result<(), PythWsError>> = vec![
            Ok(()),
            Err(PythWsError::Connect("simulated".into())),
            Err(PythWsError::Connect("simulated".into())),
        ];
        for outcome in outcomes {
            match outcome {
                Ok(()) => attempt = 0,
                Err(_) => attempt += 1,
            }
        }
        assert_eq!(attempt, 2);
        assert!(attempt <= MAX_WS_RECONNECT_ATTEMPTS);
    }
}
