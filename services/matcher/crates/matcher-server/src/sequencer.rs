//! Single-writer sequencer actor (Phase 2, Hybrid CLOB).
//!
//! All order placement, cancellation, and matching flows through this
//! actor. It owns the persistent order books and produces fills that
//! the batch flusher settles on-chain.
//!
//! Communication is via `tokio::sync::mpsc` — the WS gateway and gRPC
//! handler send `SequencerCommand`s, the sequencer processes them
//! serially (no locks needed inside the hot path).

use std::collections::BTreeMap;

use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};

use bufi_orderbook::{cancel_intent, match_intent, Fill, OrderBook};

use crate::intent_translator::TranslatedIntent;

pub type IntentId = [u8; 32];
pub type MarketId = [u8; 32];

#[derive(Debug)]
pub enum AckStatus {
    Filled,
    Partial,
    Resting,
    Rejected(String),
    Cancelled,
    NotFound,
}

pub struct PlaceAck {
    pub status: AckStatus,
    pub fills: Vec<Fill>,
}

pub struct CancelAck {
    pub status: AckStatus,
}

pub enum SequencerCommand {
    Place {
        translated: TranslatedIntent,
        reply: oneshot::Sender<PlaceAck>,
    },
    Cancel {
        intent_id: IntentId,
        reply: oneshot::Sender<CancelAck>,
    },
}

pub struct PairedFill {
    pub maker: TranslatedIntent,
    pub taker: TranslatedIntent,
    pub fill: Fill,
}

pub struct Sequencer {
    books: BTreeMap<MarketId, OrderBook>,
    intent_store: BTreeMap<IntentId, TranslatedIntent>,
    match_seq: u64,
    fill_tx: mpsc::UnboundedSender<PairedFill>,
    grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
}

impl Sequencer {
    pub fn new(
        fill_tx: mpsc::UnboundedSender<PairedFill>,
        grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
    ) -> Self {
        Self {
            books: BTreeMap::new(),
            intent_store: BTreeMap::new(),
            match_seq: 0,
            fill_tx,
            grpc_state,
        }
    }

    pub async fn run(mut self, mut rx: mpsc::Receiver<SequencerCommand>) {
        info!("sequencer actor started (Phase 2)");
        while let Some(cmd) = rx.recv().await {
            match cmd {
                SequencerCommand::Place { translated, reply } => {
                    let ack = self.handle_place(translated);
                    let _ = reply.send(ack);
                }
                SequencerCommand::Cancel { intent_id, reply } => {
                    let ack = self.handle_cancel(intent_id);
                    let _ = reply.send(ack);
                }
            }
        }
        info!("sequencer actor stopped (channel closed)");
    }

    fn handle_place(&mut self, translated: TranslatedIntent) -> PlaceAck {
        let market_id = translated.orderbook_intent.market_id;
        let intent_id = translated.orderbook_intent.id;

        self.intent_store.insert(intent_id, translated.clone());

        let book = self
            .books
            .entry(market_id)
            .or_insert_with(|| OrderBook::new(market_id));

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let outcome = match_intent(
            book,
            translated.orderbook_intent.clone(),
            now_ms,
            self.match_seq,
        );
        self.match_seq = self.match_seq.wrapping_add(1);

        let mut ack_fills = Vec::new();
        for fill in &outcome.fills {
            let maker = self.intent_store.get(&fill.maker_intent_id).cloned();
            let taker = self.intent_store.get(&fill.taker_intent_id).cloned();
            match (maker, taker) {
                (Some(m), Some(t)) => {
                    ack_fills.push(fill.clone());
                    let _ = self.fill_tx.send(PairedFill {
                        maker: m,
                        taker: t,
                        fill: fill.clone(),
                    });
                }
                _ => {
                    warn!(
                        fill_id = ?fill.fill_id,
                        "fill references unknown intent in sequencer"
                    );
                }
            }
        }

        if let Some(state) = &self.grpc_state {
            let (bids, asks) = crate::grpc::extract_book_levels(book);
            let state = state.clone();
            let mid = market_id;
            tokio::spawn(async move {
                state.publish_book_snapshot(mid, bids, asks).await;
            });
        }

        let status = if outcome.residual.is_zero() && !ack_fills.is_empty() {
            AckStatus::Filled
        } else if !ack_fills.is_empty() {
            AckStatus::Partial
        } else {
            AckStatus::Resting
        };

        PlaceAck {
            status,
            fills: ack_fills,
        }
    }

    fn handle_cancel(&mut self, intent_id: IntentId) -> CancelAck {
        let location = self
            .books
            .values()
            .find_map(|b| b.locate(intent_id).map(|_| b.market_id));

        match location {
            Some(market_id) => {
                if let Some(book) = self.books.get_mut(&market_id) {
                    let _ = cancel_intent(book, intent_id);
                    self.intent_store.remove(&intent_id);
                    CancelAck {
                        status: AckStatus::Cancelled,
                    }
                } else {
                    CancelAck {
                        status: AckStatus::NotFound,
                    }
                }
            }
            None => CancelAck {
                status: AckStatus::NotFound,
            },
        }
    }
}
