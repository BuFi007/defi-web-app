//! Batch flusher — drains fills from the sequencer and settles on-chain.
//!
//! Runs on a timer (default 3s) or when the fill buffer hits capacity
//! (default 20 fills), whichever fires first.

use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{info, warn};

use bufi_perps_db::PerpsDb;
use bufi_perps_onchain::PerpsOnchain;

use crate::sequencer::PairedFill;
use crate::settlement;

pub struct BatchFlusherConfig {
    pub interval: Duration,
    pub max_fills: usize,
}

impl Default for BatchFlusherConfig {
    fn default() -> Self {
        Self {
            interval: Duration::from_millis(3_000),
            max_fills: 20,
        }
    }
}

pub struct BatchFlusher {
    db: PerpsDb,
    onchain: PerpsOnchain,
    config: BatchFlusherConfig,
    grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
}

impl BatchFlusher {
    pub fn new(
        db: PerpsDb,
        onchain: PerpsOnchain,
        config: BatchFlusherConfig,
        grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
    ) -> Self {
        Self {
            db,
            onchain,
            config,
            grpc_state,
        }
    }

    pub async fn run(self, mut fill_rx: mpsc::UnboundedReceiver<PairedFill>) {
        info!(
            interval_ms = self.config.interval.as_millis() as u64,
            max_fills = self.config.max_fills,
            "batch flusher started (Phase 2)"
        );

        let mut timer = interval(self.config.interval);
        timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut buffer: Vec<PairedFill> = Vec::with_capacity(self.config.max_fills);

        loop {
            tokio::select! {
                _ = timer.tick() => {
                    if !buffer.is_empty() {
                        self.flush(&mut buffer).await;
                    }
                }
                recv = fill_rx.recv() => {
                    match recv {
                        Some(fill) => {
                            buffer.push(fill);
                            if buffer.len() >= self.config.max_fills {
                                self.flush(&mut buffer).await;
                            }
                        }
                        None => {
                            if !buffer.is_empty() {
                                self.flush(&mut buffer).await;
                            }
                            info!("batch flusher stopped (fill channel closed)");
                            return;
                        }
                    }
                }
            }
        }
    }

    async fn flush(&self, buffer: &mut Vec<PairedFill>) {
        let batch: Vec<_> = buffer
            .drain(..)
            .map(|pf| (pf.maker, pf.taker, pf.fill))
            .collect();
        let count = batch.len();
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let settled = settlement::settle_batch(
            &self.db,
            &self.onchain,
            &batch,
            now_secs,
            self.grpc_state.as_deref(),
        )
        .await;

        if settled > 0 {
            info!(batch_size = count, settled, "batch flushed");
        } else if count > 0 {
            warn!(batch_size = count, "batch flush: 0 settled from {count} fills");
        }
    }
}
