//! Adaptive tick loop.
//!
//! ```text
//!   busy interval  = config.tick_busy   (default 1 s)
//!   idle interval  = config.tick_idle   (default 30 s)
//!   relax after    = config.idle_ticks_to_relax (default 5)
//! ```
//!
//! Per tick:
//!   1. `now_secs = SystemTime::now().as_secs()`.
//!   2. Pull every pending intent on the configured chain whose deadline
//!      hasn't passed.
//!   3. Update DB status to `expired` for any whose deadline fell between
//!      `list_pending` and our `now_secs` (the SQL filter is best-effort).
//!   4. Translate each pending intent (parse + EIP-712 verify). Failures
//!      flip DB status to `rejected`.
//!   5. Build a fresh in-memory `OrderBook` per market and `match_intent`
//!      each translated intent against it.
//!   6. Pair every produced fill with the maker and taker `TranslatedIntent`,
//!      then `settlement::settle_batch`.
//!   7. Return `did_work` = (matched_any || expired_any || rejected_any).
//!
//! The tick is pure orchestration; all IO and matching live in their own
//! modules. This file is deliberately short — the surface area is the
//! state machine, not the heavy lifting.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::time::sleep;
use tracing::{info, warn};

use bufi_orderbook::{cancel_intent, match_intent, Fill, LpStateView, OrderBook};
use bufi_perps_db::{PerpIntentStatus, PerpsDb};
use bufi_perps_onchain::{PerpsDeployment, PerpsOnchain};

use crate::config::Config;
use crate::intent_translator::{self, TranslatedIntent};
use crate::lp_router::{self};
use crate::lp_signer::LpSigner;
use crate::settlement;

/// Outcome of one tick — drives the adaptive pacer.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // settled/pending land in the tracing log only.
pub struct TickOutcome {
    /// `true` iff any of: a fill landed, an intent expired, an intent was
    /// rejected for being malformed. Used to short-circuit the idle pacer.
    pub did_work: bool,
    /// Pure counts for the tracing log line; not consumed elsewhere.
    pub settled: usize,
    /// Number of pending intents the tick observed.
    pub pending: usize,
}

/// Single tick. Returns once all pending intents this iteration are handled.
///
/// `lp` is the optional (LP signer + LP state view) pair. When `Some`,
/// the tick will try to route residuals to LP after the CLOB walk
/// exhausts. When `None`, LP routing is skipped (pure CLOB behaviour).
pub async fn tick<L: LpStateView>(
    db: &PerpsDb,
    onchain: &PerpsOnchain,
    deployment: &PerpsDeployment,
    chain_id: i64,
    lp: Option<(&LpSigner, &L)>,
    grpc_state: Option<&crate::grpc::GrpcState>,
) -> TickOutcome {
    let now_secs = current_unix_secs();
    let pending = match db.list_pending(chain_id, now_secs).await {
        Ok(p) => p,
        Err(e) => {
            warn!(error = ?e, "list_pending failed");
            return TickOutcome {
                did_work: false,
                settled: 0,
                pending: 0,
            };
        }
    };
    let pending_count = pending.len();
    if pending.is_empty() {
        return TickOutcome {
            did_work: false,
            settled: 0,
            pending: 0,
        };
    }

    // Translate + classify.
    let mut translated_by_market: BTreeMap<[u8; 32], Vec<TranslatedIntent>> = BTreeMap::new();
    let mut translated_lookup: BTreeMap<[u8; 32], TranslatedIntent> = BTreeMap::new();
    let mut expired = 0usize;
    let mut rejected = 0usize;
    for intent in pending {
        // Defensive: list_pending filters on `deadline > now_secs` but the
        // tick can take seconds — re-check and expire here.
        if intent.deadline <= now_secs {
            if let Err(e) = db
                .update_status(&intent.intent_id, PerpIntentStatus::Expired, now_secs)
                .await
            {
                warn!(intent_id = intent.intent_id, error = ?e, "expire update failed");
            }
            expired += 1;
            continue;
        }
        match intent_translator::translate(&intent, deployment) {
            Ok(t) => {
                translated_lookup.insert(t.orderbook_intent.id, t.clone());
                translated_by_market
                    .entry(t.orderbook_intent.market_id)
                    .or_default()
                    .push(t);
            }
            Err(e) => {
                warn!(intent_id = intent.intent_id, error = ?e, "translate failed; rejecting");
                if let Err(e2) = db
                    .update_status(&intent.intent_id, PerpIntentStatus::Rejected, now_secs)
                    .await
                {
                    warn!(intent_id = intent.intent_id, error = ?e2, "reject update failed");
                }
                rejected += 1;
            }
        }
    }

    // Per market: build a fresh book and match the intents in arrival order.
    let now_ms = (now_secs as u64).saturating_mul(1_000);
    let mut paired_fills: Vec<(TranslatedIntent, TranslatedIntent, Fill)> = Vec::new();
    let mut match_seq = 0u64;
    for (market_id_bytes, intents) in translated_by_market {
        let mut book = OrderBook::new(market_id_bytes);
        for t in intents {
            let outcome = match_intent(
                &mut book,
                t.orderbook_intent.clone(),
                now_ms,
                match_seq,
            );
            match_seq = match_seq.wrapping_add(1);
            for fill in outcome.fills {
                let maker = translated_lookup.get(&fill.maker_intent_id).cloned();
                let taker = translated_lookup.get(&fill.taker_intent_id).cloned();
                match (maker, taker) {
                    (Some(m), Some(t)) => paired_fills.push((m, t, fill)),
                    _ => warn!(
                        fill_id = ?fill.fill_id,
                        "fill references intent not in this tick's translated set"
                    ),
                }
            }

            // ----- LP backstop routing (Phase 4) -----
            //
            // If CLOB left a residual AND we have an LP configured AND the
            // intent's TIF allows IOC-style fallback (GTC + IOC both
            // qualify; FOK never reaches this branch because peek_match
            // would have already rejected it), try the LP router. If LP
            // accepts, we add a paired fill AND remove the residual from
            // the book (under GTC, match_intent already rested it).
            if let Some((signer, lp_state)) = lp {
                if !outcome.residual.is_zero() {
                    let route = lp_router::try_route_residual_to_lp(
                        lp_router::RouteContext {
                            onchain,
                            lp_state,
                            signer,
                            taker: &t,
                            residual_size: outcome.residual,
                            now_ms,
                            now_secs: now_secs as u64,
                            match_seq,
                        },
                    )
                    .await;
                    match route {
                        Ok(Some(routed)) => {
                            // Persist the synthetic LP intent BEFORE settle_batch
                            // runs. settle_one calls `record_fill(maker_id, ...)`
                            // which expects a DB row; without this insert the
                            // maker-side record_fill returns NotFound, the `?`
                            // short-circuits, and the taker's record_fill never
                            // runs — leaving the chain settled but the DB taker
                            // row pending, causing repeated Permit2 nonce-reuse
                            // reverts on the next tick. (Phase 7.1 fix.)
                            let lp_row =
                                routed.to_lp_perp_intent_row(signer.address(), now_secs);
                            if let Err(e) = db.put(&lp_row).await {
                                warn!(
                                    intent_id = routed.lp_intent.db_intent_id,
                                    error = ?e,
                                    "LP intent DB insert failed; skipping route"
                                );
                            } else {
                                // GTC rested its residual on the book; remove it
                                // so we don't double-count the trade.
                                let _ = cancel_intent(&mut book, t.orderbook_intent.id);
                                paired_fills.push((
                                    routed.lp_intent,
                                    routed.taker_intent,
                                    routed.fill,
                                ));
                                match_seq = match_seq.wrapping_add(1);
                            }
                        }
                        Ok(None) => {
                            // LP not configured for this market — leave the
                            // residual where match_intent put it.
                        }
                        Err(e) => {
                            warn!(
                                intent_id = t.db_intent_id,
                                error = ?e,
                                "LP router denied residual; leaving on book / dropped per TIF"
                            );
                        }
                    }
                }
            }
        }

        // Phase 8c — publish the post-match book snapshot for gRPC
        // consumers (GetBook + StreamBook). Done per-market so each
        // subscriber sees state aligned with the market that
        // triggered the update.
        if let Some(state) = grpc_state {
            let (bids, asks) = crate::grpc::extract_book_levels(&book);
            state.publish_book_snapshot(market_id_bytes, bids, asks).await;
        }
    }

    let settled = if paired_fills.is_empty() {
        0
    } else {
        settlement::settle_batch(db, onchain, &paired_fills, now_secs, grpc_state).await
    };

    let did_work = settled > 0 || expired > 0 || rejected > 0;
    info!(
        pending = pending_count,
        expired,
        rejected,
        settled,
        did_work,
        "tick complete"
    );
    TickOutcome {
        did_work,
        settled,
        pending: pending_count,
    }
}

/// Adaptive pacing loop. Runs forever until cancelled. `grpc_state` is
/// the shared gRPC state — when present, fills are broadcast via its
/// trade channel and Health's match_sequence_number / last_fill_ts are
/// updated. Pass `None` if the gRPC server is disabled.
pub async fn run<L: LpStateView + Send + Sync>(
    db: PerpsDb,
    onchain: PerpsOnchain,
    deployment: PerpsDeployment,
    config: Config,
    lp_signer: Option<LpSigner>,
    lp_state: Option<L>,
    grpc_state: Option<std::sync::Arc<crate::grpc::GrpcState>>,
) {
    let mut idle_streak: u32 = 0;
    let mut match_seq: u64 = 0;
    loop {
        match_seq = match_seq.wrapping_add(1);
        if let Some(state) = grpc_state.as_ref() {
            state
                .match_sequence_number
                .store(match_seq, std::sync::atomic::Ordering::Relaxed);
        }
        let grpc_ref = grpc_state.as_deref();
        let outcome = match (&lp_signer, &lp_state) {
            (Some(s), Some(v)) => {
                tick(
                    &db,
                    &onchain,
                    &deployment,
                    config.chain_id as i64,
                    Some((s, v)),
                    grpc_ref,
                )
                .await
            }
            _ => {
                tick::<L>(
                    &db,
                    &onchain,
                    &deployment,
                    config.chain_id as i64,
                    None,
                    grpc_ref,
                )
                .await
            }
        };
        if outcome.did_work {
            idle_streak = 0;
        } else {
            idle_streak = idle_streak.saturating_add(1);
        }
        let interval = if idle_streak >= config.idle_ticks_to_relax {
            config.tick_idle
        } else {
            config.tick_busy
        };
        sleep(interval).await;
    }
}

fn current_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn busy_interval_picked_when_did_work() {
        let cfg = make_cfg(1, 5);
        let interval = pick_interval(0, true, &cfg);
        assert_eq!(interval, Duration::from_millis(1));
    }

    #[test]
    fn idle_interval_picked_only_after_relax_threshold() {
        let cfg = make_cfg(1, 5);
        assert_eq!(pick_interval(0, false, &cfg), Duration::from_millis(1));
        assert_eq!(pick_interval(4, false, &cfg), Duration::from_millis(1));
        assert_eq!(pick_interval(5, false, &cfg), Duration::from_millis(5));
        assert_eq!(pick_interval(10, false, &cfg), Duration::from_millis(5));
    }

    fn make_cfg(busy_ms: u64, idle_ms: u64) -> Config {
        Config {
            chain_id: 5_042_002,
            rpc_url: "http://localhost:0".into(),
            signer_key_hex: None,
            lp_operator_key_hex: None,
            db_path: ".bufi/test.sqlite".into(),
            fx_telarana_deployments_dir: None,
            tick_busy: Duration::from_millis(busy_ms),
            tick_idle: Duration::from_millis(idle_ms),
            idle_ticks_to_relax: 5,
            event_poll: Duration::from_millis(1),
            event_confirmations: 0,
            event_cursor_path: ".bufi/cursor.json".into(),
            funding_poll: Duration::from_millis(1),
            funding_poke_min_interval: Duration::from_millis(1),
            funding_market_ids: Vec::new(),
            canary_trader_key_hex: None,
            canary_interval: Duration::from_secs(1),
            canary_timeout: Duration::from_secs(1),
            canary_market_id: [0u8; 32],
            canary_notional_usdc_e6: 1,
            pyth_push_interval: Duration::from_millis(1),
            pyth_push_max_age: Duration::from_secs(30),
            pyth_hermes_url: "https://hermes.pyth.network".into(),
            pyth_hermes_timeout: Duration::from_secs(10),
            grpc_bind: String::new(), // disabled in tick unit tests
        }
    }

    /// Mirror of the pacing decision inside `run` so it can be unit-tested
    /// without spinning a real loop.
    fn pick_interval(idle_streak: u32, did_work: bool, cfg: &Config) -> Duration {
        let next_streak = if did_work { 0 } else { idle_streak.saturating_add(1) };
        if next_streak.saturating_sub(1) >= cfg.idle_ticks_to_relax {
            cfg.tick_idle
        } else {
            cfg.tick_busy
        }
    }
}
