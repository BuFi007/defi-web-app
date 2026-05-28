//! Batch flusher — drains fills from the sequencer and settles on-chain.
//!
//! Runs on a timer (default 3s) or when the fill buffer hits capacity
//! (default 20 fills), whichever fires first.
//!
//! ## Durability
//!
//! Fills are NEVER moved into a black-hole drain. Instead, the flusher
//! maintains two queues:
//!
//!   * `active`  — fills accumulating since the last flush attempt.
//!   * `pending` — fills currently being retried after a transient on-chain
//!     failure. Each pending entry carries an `attempts` counter.
//!
//! When a flush fires, we concatenate `pending + active` into a single
//! attempt batch, call `settle_batch_with_results`, then bucket the
//! parallel result vec:
//!
//!   * `Settled`           → drop (success).
//!   * `OiBlocked`         → drop (re-place upstream is a separate concern;
//!                          OI cap doesn't relieve by retry alone).
//!   * `TransientFailure`  → keep in `pending`, bump attempts, retry on
//!                          next tick with exponential backoff.
//!   * `PermanentFailure`  → drop with a loud error.
//!
//! After `MAX_ATTEMPTS` transient failures on the same fill, the flusher
//! gives up and emits a `batch_settle_giveup` error log so an operator
//! alert can pick it up.

use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{error, info, warn};

use bufi_perps_db::PerpsDb;
use bufi_perps_onchain::PerpsOnchain;

use crate::sequencer::PairedFill;
use crate::settlement::{self, BatchSettleResult};

/// Hard cap on transient retries for a single fill. After this many
/// attempts the flusher drops the fill and logs an error.
const MAX_ATTEMPTS: u32 = 3;

/// Base backoff before a pending fill is eligible for retry. Doubled
/// each attempt (0.5s → 1s → 2s under MAX_ATTEMPTS=3).
const RETRY_BACKOFF_BASE: Duration = Duration::from_millis(500);

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

/// Internal wrapper around a `PairedFill` that tracks retry state.
struct PendingFill {
    fill: PairedFill,
    attempts: u32,
    /// Earliest instant at which this fill is eligible to be retried.
    next_attempt_at: Instant,
}

impl PendingFill {
    fn new(fill: PairedFill) -> Self {
        Self {
            fill,
            attempts: 0,
            next_attempt_at: Instant::now(),
        }
    }

    fn schedule_retry(&mut self) {
        self.attempts = self.attempts.saturating_add(1);
        let mult = 1u32 << self.attempts.min(8);
        self.next_attempt_at = Instant::now() + RETRY_BACKOFF_BASE * mult;
    }
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
        let mut active: Vec<PairedFill> = Vec::with_capacity(self.config.max_fills);
        let mut pending: Vec<PendingFill> = Vec::new();

        loop {
            tokio::select! {
                _ = timer.tick() => {
                    self.flush(&mut active, &mut pending).await;
                }
                recv = fill_rx.recv() => {
                    match recv {
                        Some(fill) => {
                            active.push(fill);
                            if active.len() >= self.config.max_fills {
                                self.flush(&mut active, &mut pending).await;
                            }
                        }
                        None => {
                            if !active.is_empty() || !pending.is_empty() {
                                self.flush(&mut active, &mut pending).await;
                            }
                            info!("batch flusher stopped (fill channel closed)");
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Try to settle every fill that is either:
    ///   * sitting in `active` (newly arrived), or
    ///   * in `pending` and past its `next_attempt_at` backoff.
    ///
    /// After the attempt we re-partition based on per-fill `BatchSettleResult`.
    /// The caller's `active` and `pending` vecs are mutated in place.
    async fn flush(&self, active: &mut Vec<PairedFill>, pending: &mut Vec<PendingFill>) {
        let now = Instant::now();

        // Pull every pending fill whose backoff has elapsed; leave the rest
        // in `pending` untouched so they retry on a later tick.
        let mut retry_now: Vec<PendingFill> = Vec::new();
        let mut keep_for_later: Vec<PendingFill> = Vec::with_capacity(pending.len());
        for p in pending.drain(..) {
            if p.next_attempt_at <= now {
                retry_now.push(p);
            } else {
                keep_for_later.push(p);
            }
        }
        *pending = keep_for_later;

        if active.is_empty() && retry_now.is_empty() {
            return;
        }

        // Build the attempt batch — retries first, then newly arrived fills.
        // Retries get priority because their position in the matching
        // sequence is older.
        let retry_count = retry_now.len();
        let active_count = active.len();
        let mut batch_fills: Vec<(_, _, _)> =
            Vec::with_capacity(retry_count + active_count);
        let mut origins: Vec<PendingOrigin> = Vec::with_capacity(retry_count + active_count);
        for p in retry_now {
            batch_fills.push((
                p.fill.maker.clone(),
                p.fill.taker.clone(),
                p.fill.fill.clone(),
            ));
            origins.push(PendingOrigin::Retry(p));
        }
        for fill in active.drain(..) {
            batch_fills.push((fill.maker.clone(), fill.taker.clone(), fill.fill.clone()));
            origins.push(PendingOrigin::Fresh(fill));
        }

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let results = settlement::settle_batch_with_results(
            &self.db,
            &self.onchain,
            &batch_fills,
            now_secs,
            self.grpc_state.as_deref(),
        )
        .await;

        // Buckets for the log line below.
        let mut settled = 0usize;
        let mut transient = 0usize;
        let mut oi_blocked = 0usize;
        let mut permanent = 0usize;
        let mut gave_up = 0usize;

        for (result, origin) in results.into_iter().zip(origins.into_iter()) {
            match result {
                BatchSettleResult::Settled => {
                    settled += 1;
                }
                BatchSettleResult::OiBlocked => {
                    // OI cap doesn't clear by retry alone — drop. The
                    // upstream sequencer or operator must intervene.
                    oi_blocked += 1;
                }
                BatchSettleResult::PermanentFailure => {
                    permanent += 1;
                }
                BatchSettleResult::TransientFailure => {
                    let mut p = match origin {
                        PendingOrigin::Retry(p) => p,
                        PendingOrigin::Fresh(f) => PendingFill::new(f),
                    };
                    if p.attempts + 1 >= MAX_ATTEMPTS {
                        error!(
                            attempts = p.attempts + 1,
                            max_attempts = MAX_ATTEMPTS,
                            maker_intent = p.fill.maker.db_intent_id,
                            taker_intent = p.fill.taker.db_intent_id,
                            "batch_settle_giveup: max retries exhausted, dropping fill"
                        );
                        gave_up += 1;
                    } else {
                        p.schedule_retry();
                        transient += 1;
                        pending.push(p);
                    }
                    // origin was consumed above
                    continue;
                }
            }
            // For non-transient outcomes we drop the origin — both Fresh
            // and Retry are released here.
            drop(origin);
        }

        if settled > 0 || transient > 0 || oi_blocked > 0 || permanent > 0 || gave_up > 0 {
            info!(
                attempted = retry_count + active_count,
                settled,
                transient,
                oi_blocked,
                permanent,
                gave_up,
                pending_after = pending.len(),
                "batch flushed"
            );
        } else if retry_count + active_count > 0 {
            warn!(
                attempted = retry_count + active_count,
                "batch flush: no fills settled"
            );
        }
    }
}

/// Which queue did a slot in the attempt batch come from. Used so a
/// transient failure on a retry can bump its existing attempt counter
/// rather than starting over at zero.
enum PendingOrigin {
    Retry(PendingFill),
    Fresh(PairedFill),
}
