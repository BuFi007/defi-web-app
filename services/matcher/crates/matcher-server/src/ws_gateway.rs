//! WebSocket gateway for the Hybrid CLOB sequencer (Phase 2).
//!
//! Accepts WS connections on `MATCHER_WS_BIND`, routes place/cancel
//! commands to the sequencer actor, returns acks.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};

use bufi_perps_onchain::PerpsDeployment;

use crate::intent_translator;
use crate::sequencer::{AckStatus, CancelAck, PlaceAck, SequencerCommand};

#[derive(Clone)]
pub struct WsState {
    pub seq_tx: mpsc::Sender<SequencerCommand>,
    pub deployment: Arc<PerpsDeployment>,
}

pub async fn serve(addr: SocketAddr, state: WsState) -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/v1/markets", get(ws_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(bind = %addr, "WS gateway listening (Phase 2)");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WsState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_connection(socket, state))
}

async fn handle_connection(mut socket: WebSocket, state: WsState) {
    while let Some(msg) = socket.recv().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                warn!(error = ?e, "ws read error");
                break;
            }
        };

        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                let _ = socket
                    .send(Message::Text(
                        r#"{"type":"error","message":"invalid JSON"}"#.into(),
                    ))
                    .await;
                continue;
            }
        };

        let action = parsed["action"].as_str().unwrap_or("");
        let resp = match action {
            "place" => handle_place(&parsed, &state).await,
            "cancel" => handle_cancel(&parsed, &state).await,
            "ping" => r#"{"type":"pong"}"#.to_string(),
            _ => format!(r#"{{"type":"error","message":"unknown action: {action}"}}"#),
        };
        let _ = socket.send(Message::Text(resp.into())).await;
    }
}

async fn handle_place(parsed: &serde_json::Value, state: &WsState) -> String {
    let order = &parsed["signedOrder"];
    let sig_hex = parsed["signature"].as_str().unwrap_or("");

    let trader = order["trader"].as_str().unwrap_or("");
    let market_id = order["marketId"].as_str().unwrap_or("");
    let size_delta = order["sizeDeltaE18"].as_str().unwrap_or("0");
    let price_e18 = order["priceE18"].as_str().unwrap_or("0");
    let nonce = order["nonce"].as_str().unwrap_or("0");
    let deadline = order["deadline"].as_u64().unwrap_or(0);
    let order_type_code = order["orderType"].as_u64().unwrap_or(1);
    let flags = order["flags"].as_u64().unwrap_or(0) as i64;

    let side_str = if size_delta.starts_with('-') { "short" } else { "long" };
    let order_type_str = if order_type_code == 0 { "market" } else { "limit" };

    let db_intent = bufi_perps_db::PerpIntent {
        intent_id: format!("ws-{nonce}"),
        chain_id: state.deployment.chain_id as i64,
        trader: trader.to_string(),
        market_id: market_id.to_string(),
        side: if side_str == "long" {
            bufi_perps_db::PerpSide::Long
        } else {
            bufi_perps_db::PerpSide::Short
        },
        size_usdc: "0".to_string(),
        size_delta: size_delta.to_string(),
        filled_size_delta: "0".to_string(),
        remaining_size_delta: size_delta.to_string(),
        leverage: 1,
        order_type: if order_type_str == "market" {
            bufi_perps_db::PerpOrderType::Market
        } else {
            bufi_perps_db::PerpOrderType::Limit
        },
        price_e18: price_e18.to_string(),
        limit_price: None,
        reduce_only: flags & 1 != 0,
        post_only: flags & 2 != 0,
        flags,
        digest: String::new(),
        signature: sig_hex.to_string(),
        nonce: nonce.to_string(),
        deadline: deadline as i64,
        status: bufi_perps_db::PerpIntentStatus::Pending,
        replacement_of: None,
        created_at: chrono_now_secs(),
        updated_at: chrono_now_secs(),
    };

    let translated = match intent_translator::translate(&db_intent, &state.deployment) {
        Ok(t) => t,
        Err(e) => {
            return format!(
                r#"{{"type":"ack","status":"rejected","reason":"{}"}}"#,
                e.to_string().replace('"', "'")
            );
        }
    };

    let intent_id_hex = format!("0x{}", bytes32_to_hex(&translated.orderbook_intent.id));

    let (reply_tx, reply_rx) = oneshot::channel();
    if state
        .seq_tx
        .send(SequencerCommand::Place {
            translated,
            reply: reply_tx,
        })
        .await
        .is_err()
    {
        return r#"{"type":"error","message":"sequencer unavailable"}"#.to_string();
    }

    match reply_rx.await {
        Ok(ack) => {
            let status = match ack.status {
                AckStatus::Filled => "filled",
                AckStatus::Partial => "partial",
                AckStatus::Resting => "resting",
                AckStatus::Rejected(ref r) => "rejected",
                _ => "unknown",
            };
            let fill_count = ack.fills.len();
            format!(
                r#"{{"type":"ack","intentId":"{intent_id_hex}","status":"{status}","fills":{fill_count}}}"#
            )
        }
        Err(_) => r#"{"type":"error","message":"sequencer dropped reply"}"#.to_string(),
    }
}

async fn handle_cancel(parsed: &serde_json::Value, state: &WsState) -> String {
    let intent_id_hex = parsed["intentId"].as_str().unwrap_or("");
    let intent_id_bytes = match parse_bytes32(intent_id_hex) {
        Some(b) => b,
        None => {
            return r#"{"type":"cancelAck","status":"rejected","reason":"invalid intentId"}"#
                .to_string();
        }
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    if state
        .seq_tx
        .send(SequencerCommand::Cancel {
            intent_id: intent_id_bytes,
            reply: reply_tx,
        })
        .await
        .is_err()
    {
        return r#"{"type":"error","message":"sequencer unavailable"}"#.to_string();
    }

    match reply_rx.await {
        Ok(ack) => {
            let status = match ack.status {
                AckStatus::Cancelled => "canceled",
                AckStatus::NotFound => "not_found",
                _ => "unknown",
            };
            format!(r#"{{"type":"cancelAck","intentId":"{intent_id_hex}","status":"{status}"}}"#)
        }
        Err(_) => r#"{"type":"error","message":"sequencer dropped reply"}"#.to_string(),
    }
}

fn parse_bytes32(s: &str) -> Option<[u8; 32]> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    if stripped.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
        let hi = hex_val(chunk[0])?;
        let lo = hex_val(chunk[1])?;
        out[i] = (hi << 4) | lo;
    }
    Some(out)
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn bytes32_to_hex(b: &[u8; 32]) -> String {
    b.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
