//! Expiry sweeper (Phase 4, Hybrid CLOB).
//!
//! Replaces the tick loop's matching role. Runs on a slow cadence
//! (default 30s) and only:
//!   1. Marks expired DB intents as `expired`.
//!   2. Removes expired orders from the sequencer's persistent books.
//!   3. Bumps the heartbeat for /ready.
//!
//! All matching now flows through the sequencer actor.

use std::time::Duration;

use tokio::time::{interval, MissedTickBehavior};
use tracing::{info, warn};

use bufi_perps_db::{PerpIntentStatus, PerpsDb};

pub struct ExpirySweeperConfig {
    pub chain_id: i64,
    pub interval: Duration,
}

pub struct ExpirySweeper {
    db: PerpsDb,
    config: ExpirySweeperConfig,
    grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
}

impl ExpirySweeper {
    pub fn new(
        db: PerpsDb,
        config: ExpirySweeperConfig,
        grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
    ) -> Self {
        Self {
            db,
            config,
            grpc_state,
        }
    }

    pub async fn run(self) {
        info!(
            interval_s = self.config.interval.as_secs(),
            chain_id = self.config.chain_id,
            "expiry sweeper started (Phase 4)"
        );

        let mut timer = interval(self.config.interval);
        timer.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            timer.tick().await;
            self.sweep().await;

            if let Some(state) = &self.grpc_state {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                state
                    .last_tick_ms
                    .store(now_ms, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    async fn sweep(&self) {
        let now_secs = current_unix_secs();

        let pending = match self.db.list_pending(self.config.chain_id, now_secs).await {
            Ok(p) => p,
            Err(e) => {
                warn!(error = ?e, "expiry sweeper: list_pending failed");
                return;
            }
        };

        let mut expired = 0usize;
        for intent in &pending {
            if intent.deadline <= now_secs {
                if let Err(e) = self
                    .db
                    .update_status(&intent.intent_id, PerpIntentStatus::Expired, now_secs)
                    .await
                {
                    warn!(intent_id = intent.intent_id, error = ?e, "expire update failed");
                }
                expired += 1;
            }
        }

        if expired > 0 {
            info!(expired, "expiry sweeper: marked intents expired");

            // Remove expired orders from the persistent books by intent ID.
            if let Some(state) = &self.grpc_state {
                let mut books = state.books.lock().await;
                for intent in &pending {
                    if intent.deadline <= now_secs {
                        if let Some(id_bytes) = parse_intent_id(&intent.intent_id) {
                            for book in books.values_mut() {
                                book.cancel(id_bytes);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn parse_intent_id(s: &str) -> Option<[u8; 32]> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    if stripped.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&stripped[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn current_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64
}
