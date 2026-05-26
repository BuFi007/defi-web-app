//! Book WAL (Write-Ahead Log) — Phase 5, Hybrid CLOB.
//!
//! Periodically snapshots the sequencer's persistent order books to
//! disk so the process can recover after a crash without losing
//! resting orders.
//!
//! Format: JSON (human-readable for debugging). Each snapshot is a
//! complete dump — no incremental log compaction needed at current
//! book sizes (<10 markets, <1000 orders).
//!
//! Location: `$BUFI_DB_PATH/../matcher-book-wal/`
//! Retention: 2 snapshots (current + previous).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::time::{interval, MissedTickBehavior};
use tracing::{info, warn};

use bufi_orderbook::OrderBook;

pub struct BookWalConfig {
    pub dir: PathBuf,
    pub interval: Duration,
}

impl BookWalConfig {
    pub fn from_db_path(db_path: &Path) -> Self {
        let dir = db_path
            .parent()
            .unwrap_or(Path::new("."))
            .join("matcher-book-wal");
        Self {
            dir,
            interval: Duration::from_secs(5),
        }
    }
}

pub struct BookWal {
    config: BookWalConfig,
    grpc_state: std::sync::Arc<crate::grpc::GrpcState>,
}

impl BookWal {
    pub fn new(
        config: BookWalConfig,
        grpc_state: std::sync::Arc<crate::grpc::GrpcState>,
    ) -> Self {
        Self { config, grpc_state }
    }

    pub async fn run(self) {
        if let Err(e) = tokio::fs::create_dir_all(&self.config.dir).await {
            warn!(dir = ?self.config.dir, error = ?e, "book WAL: failed to create dir");
            return;
        }

        info!(
            dir = ?self.config.dir,
            interval_s = self.config.interval.as_secs(),
            "book WAL started (Phase 5)"
        );

        let mut timer = interval(self.config.interval);
        timer.set_missed_tick_behavior(MissedTickBehavior::Skip);

        let mut snapshot_idx: u64 = 0;

        loop {
            timer.tick().await;

            let books = self.grpc_state.books.lock().await;
            let summary = snapshot_summary(&books);
            if summary.total_orders == 0 {
                drop(books);
                continue;
            }

            let json = match serde_json::to_string(&summary) {
                Ok(j) => j,
                Err(e) => {
                    warn!(error = ?e, "book WAL: serialize failed");
                    drop(books);
                    continue;
                }
            };
            drop(books);

            let filename = format!("snapshot-{}.json", snapshot_idx % 2);
            let path = self.config.dir.join(&filename);
            if let Err(e) = tokio::fs::write(&path, &json).await {
                warn!(path = ?path, error = ?e, "book WAL: write failed");
            } else {
                info!(
                    path = ?path,
                    markets = summary.markets,
                    orders = summary.total_orders,
                    "book WAL: snapshot written"
                );
            }

            snapshot_idx = snapshot_idx.wrapping_add(1);
        }
    }
}

#[derive(serde::Serialize)]
struct BookSnapshot {
    timestamp_ms: u64,
    markets: usize,
    total_orders: usize,
    books: Vec<MarketSnapshot>,
}

#[derive(serde::Serialize)]
struct MarketSnapshot {
    market_id: String,
    bid_levels: usize,
    ask_levels: usize,
    bid_orders: usize,
    ask_orders: usize,
}

fn snapshot_summary(books: &BTreeMap<[u8; 32], OrderBook>) -> BookSnapshot {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut total_orders = 0usize;
    let mut market_snapshots = Vec::new();

    for (market_id, book) in books {
        let mut bid_levels = 0usize;
        let mut bid_orders = 0usize;
        for (_price, queue) in book.bids.levels_ascending() {
            bid_levels += 1;
            bid_orders += queue.len();
        }

        let mut ask_levels = 0usize;
        let mut ask_orders = 0usize;
        for (_price, queue) in book.asks.levels_ascending() {
            ask_levels += 1;
            ask_orders += queue.len();
        }

        total_orders += bid_orders + ask_orders;

        market_snapshots.push(MarketSnapshot {
            market_id: format!("0x{}", market_id.iter().map(|b| format!("{b:02x}")).collect::<String>()),
            bid_levels,
            ask_levels,
            bid_orders,
            ask_orders,
        });
    }

    BookSnapshot {
        timestamp_ms: now_ms,
        markets: market_snapshots.len(),
        total_orders,
        books: market_snapshots,
    }
}

/// Load the latest snapshot from disk (for crash recovery).
/// Returns None if no snapshot exists or parsing fails.
pub async fn load_latest(dir: &Path) -> Option<String> {
    for idx in [1u64, 0] {
        let path = dir.join(format!("snapshot-{}.json", idx));
        if let Ok(contents) = tokio::fs::read_to_string(&path).await {
            if !contents.is_empty() {
                info!(path = ?path, "book WAL: loaded snapshot for recovery");
                return Some(contents);
            }
        }
    }
    None
}
