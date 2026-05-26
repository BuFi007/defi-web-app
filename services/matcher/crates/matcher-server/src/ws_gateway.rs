//! WebSocket gateway for the Hybrid CLOB sequencer (Phase 2).
//!
//! Accepts WS connections on `MATCHER_WS_BIND`, authenticates via
//! EIP-712 session signature on the first frame, then routes
//! place/cancel commands to the sequencer actor.

use std::net::SocketAddr;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::sequencer::SequencerCommand;

#[derive(Clone)]
pub struct WsState {
    pub seq_tx: mpsc::Sender<SequencerCommand>,
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

async fn handle_connection(mut socket: WebSocket, _state: WsState) {
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
            "place" => {
                // Phase 2 stub: full EIP-712 parsing + signature verify + sequencer routing
                // will be wired in the follow-up. Gateway compiles and protocol is exercisable.
                r#"{"type":"ack","status":"received","note":"WS gateway Phase 2 stub"}"#
                    .to_string()
            }
            "cancel" => {
                r#"{"type":"cancelAck","status":"received","note":"WS gateway Phase 2 stub"}"#
                    .to_string()
            }
            "ping" => r#"{"type":"pong"}"#.to_string(),
            _ => {
                format!(r#"{{"type":"error","message":"unknown action: {action}"}}"#)
            }
        };
        let _ = socket.send(Message::Text(resp.into())).await;
    }
}
