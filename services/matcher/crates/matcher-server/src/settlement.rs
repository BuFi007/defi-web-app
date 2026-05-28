//! Settlement orchestrator.
//!
//! Per matched `Fill`:
//!
//!   1. OI gate (`oi_gate::check_fill_would_fit`).
//!   2. Convert matcher-types `SignedOrder` → onchain bindings `SignedOrder`.
//!   3. Call `FxOrderSettlement.settleMatch(...)` and wait for the receipt.
//!   4. Update DB: `record_fill(maker, +fill)` and `record_fill(taker, -fill)`
//!      (or the sign-correct variants per `intent.side`).
//!   5. Emit a `bufx.perps.replacement_needed` event for any side that
//!      partially-filled.
//!
//! On revert: leave intents at status=`pending` so the next tick retries.
//! Log loudly with the tx hash; alerting layer can route from tracing.

use alloy_primitives::{Bytes, U256};
use thiserror::Error;
use tracing::{error, info, warn};

use bufi_orderbook::{Fill, Side};
use bufi_perps_db::{PerpIntentStatus, PerpsDb, PerpsDbError};
use bufi_perps_onchain::{OiSnapshot, PerpsOnchain, PerpsOnchainError};

use crate::grpc::{fill_to_proto_trade, GrpcState};
use crate::intent_translator::TranslatedIntent;
use crate::oi_gate::{self, OiGateError};
use crate::replacement_events::{self, Role};

/// Errors raised by the settlement orchestrator.
#[derive(Debug, Error)]
pub enum SettleError {
    /// OI gate fired or RPC failed during the gate.
    #[error(transparent)]
    OiGate(#[from] OiGateError),
    /// On-chain settleMatch call returned an error.
    #[error(transparent)]
    Onchain(#[from] PerpsOnchainError),
    /// DB write failed (record_fill or domain_events insert).
    #[error(transparent)]
    Db(#[from] PerpsDbError),
    /// Underlying sqlx error from a non-PerpsDbError code path.
    #[error("sqlx: {0}")]
    Sqlx(#[from] sqlx::Error),
}

/// Outcome of a single settlement attempt — used for logging + return.
#[derive(Debug, Clone)]
#[allow(dead_code)] // oi_before is logged via fields only, not read.
pub struct SettleOutcome {
    /// `0x…` 32-byte tx hash.
    pub tx_hash: String,
    /// OI snapshot captured during the gate (informational).
    pub oi_before: OiSnapshot,
}

/// Convert the orderbook `Side` of the maker side into the sign of the
/// fill delta on a given side. Maker's resulting size moves in the maker's
/// own side direction; taker's moves in the opposite.
fn signed_delta_for_side(side: Side, magnitude: u128) -> i128 {
    let m = magnitude as i128;
    match side {
        Side::Long => m,
        Side::Short => -m,
    }
}

/// Settle one fill against the chain + persist the result.
///
/// `maker` and `taker` are the translated intents that produced this fill.
/// The caller MUST ensure `fill.maker_intent_id == maker.orderbook_intent.id`
/// and same for taker; this function does NOT re-validate that linkage.
pub async fn settle_one(
    db: &PerpsDb,
    onchain: &PerpsOnchain,
    maker: &TranslatedIntent,
    taker: &TranslatedIntent,
    fill: &Fill,
    now_secs: i64,
    grpc_state: Option<&GrpcState>,
) -> Result<SettleOutcome, SettleError> {
    // ---------- 1. OI gate ----------
    let oi_before =
        oi_gate::check_fill_would_fit(onchain, fill.market_id.into(), fill.size).await?;

    // ---------- 2. Wire format conversion ----------
    let maker_signed = to_onchain_signed(&maker.signed_order);
    let taker_signed = to_onchain_signed(&taker.signed_order);
    let maker_sig = Bytes::from(maker.signature.clone());
    let taker_sig = Bytes::from(taker.signature.clone());
    let fill_size_e18 = U256::from(fill.size.raw());
    let fill_price_e18 = U256::from(fill.price.raw().unsigned_abs());

    // ---------- 3. settleMatch ----------
    let tx_hash = onchain
        .submit_settle_match(
            maker_signed,
            maker_sig,
            taker_signed,
            taker_sig,
            fill_size_e18,
            fill_price_e18,
        )
        .await?;
    info!(
        tx = ?tx_hash,
        market = ?fill.market_id,
        size = fill.size.raw(),
        price = fill.price.raw(),
        "settleMatch confirmed"
    );

    // ---------- 4. Record fills ----------
    let fill_magnitude = fill.size.raw();
    let maker_side = maker.orderbook_intent.side;
    let taker_side = taker.orderbook_intent.side;
    debug_assert_ne!(maker_side, taker_side, "maker and taker must be opposite sides");

    let maker_delta = signed_delta_for_side(maker_side, fill_magnitude);
    let taker_delta = signed_delta_for_side(taker_side, fill_magnitude);

    let maker_updated = db
        .record_fill(&maker.db_intent_id, maker_delta, now_secs)
        .await?;
    let taker_updated = db
        .record_fill(&taker.db_intent_id, taker_delta, now_secs)
        .await?;

    // ---------- 4.5 gRPC trade broadcast (Phase 8b) ----------
    //
    // Best-effort fan-out to `StreamTrades` subscribers. The maker /
    // taker cumulative_filled values come from the post-record_fill
    // DB rows so subscribers see the full magnitude AFTER this fill
    // applied. If there are no subscribers (`send` returns 0) we just
    // drop the message — no error path because the broadcast is
    // purely informational and the canonical state lives in the DB.
    if let Some(state) = grpc_state {
        let maker_cum_e18: i128 = maker_updated.filled_size_delta.parse().unwrap_or(0);
        let taker_cum_e18: i128 = taker_updated.filled_size_delta.parse().unwrap_or(0);
        let trade = fill_to_proto_trade(
            fill,
            maker_cum_e18,
            taker_cum_e18,
            /* is_liquidation */ false,
        );
        let receivers = state.publish_trade(trade);
        // Update last-fill timestamp for the Health RPC.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        state
            .last_fill_timestamp_ms
            .store(now_ms, std::sync::atomic::Ordering::Relaxed);
        if receivers > 0 {
            tracing::debug!(receivers, "gRPC trade broadcast delivered");
        }
    }

    // ---------- 5. Replacement-needed events ----------
    let tx_hex = format!("{tx_hash:#x}");
    if maker_updated.status == PerpIntentStatus::PartiallyFilled {
        replacement_events::emit(
            db,
            replacement_events::ReplacementEvent {
                intent: &maker_updated,
                settlement_tx: tx_hex.clone(),
                role: Role::Maker,
                counterparty_intent_id: taker.db_intent_id.clone(),
                fill_size_delta: maker_delta,
                fill_price_e18: fill.price.raw().unsigned_abs(),
                emitted_at_secs: now_secs,
            },
        )
        .await?;
    }
    if taker_updated.status == PerpIntentStatus::PartiallyFilled {
        replacement_events::emit(
            db,
            replacement_events::ReplacementEvent {
                intent: &taker_updated,
                settlement_tx: tx_hex.clone(),
                role: Role::Taker,
                counterparty_intent_id: maker.db_intent_id.clone(),
                fill_size_delta: taker_delta,
                fill_price_e18: fill.price.raw().unsigned_abs(),
                emitted_at_secs: now_secs,
            },
        )
        .await?;
    }

    Ok(SettleOutcome {
        tx_hash: tx_hex,
        oi_before,
    })
}

/// Settle a batch of fills sequentially, logging failures and continuing.
/// Returns the count of successful settlements.
pub async fn settle_batch(
    db: &PerpsDb,
    onchain: &PerpsOnchain,
    fills: &[(TranslatedIntent, TranslatedIntent, Fill)],
    now_secs: i64,
    grpc_state: Option<&GrpcState>,
) -> usize {
    settle_batch_with_results(db, onchain, fills, now_secs, grpc_state)
        .await
        .into_iter()
        .filter(|r| matches!(r, BatchSettleResult::Settled))
        .count()
}

/// Per-fill outcome of a batch settle attempt. Used by the batch flusher
/// to keep transient failures in the pending queue for retry without
/// losing the maker/taker/fill context.
#[derive(Debug, Clone)]
pub enum BatchSettleResult {
    /// On-chain settleMatch succeeded.
    Settled,
    /// OI gate blocked the settlement. Re-checking on a later tick may
    /// succeed once other fills relieve OI pressure.
    OiBlocked,
    /// RPC / network / chain error. Almost always transient. The flusher
    /// should keep this fill in the pending queue and retry.
    TransientFailure,
    /// Permanent failure (DB write, malformed payload, etc.). Retrying
    /// is unlikely to help; the flusher should drop the fill.
    PermanentFailure,
}

/// Settle a batch of fills sequentially, returning a parallel `Vec` of
/// per-fill outcomes the caller can use to decide which fills to retry.
/// Order matches `fills`.
pub async fn settle_batch_with_results(
    db: &PerpsDb,
    onchain: &PerpsOnchain,
    fills: &[(TranslatedIntent, TranslatedIntent, Fill)],
    now_secs: i64,
    grpc_state: Option<&GrpcState>,
) -> Vec<BatchSettleResult> {
    let mut out = Vec::with_capacity(fills.len());
    for (maker, taker, fill) in fills {
        match settle_one(db, onchain, maker, taker, fill, now_secs, grpc_state).await {
            Ok(outcome) => {
                info!(tx = outcome.tx_hash, "fill settled");
                out.push(BatchSettleResult::Settled);
            }
            Err(SettleError::OiGate(OiGateError::CapBreach { .. })) => {
                warn!(
                    maker_intent = maker.db_intent_id,
                    taker_intent = taker.db_intent_id,
                    "OI gate blocked settlement; leaving intents pending"
                );
                out.push(BatchSettleResult::OiBlocked);
            }
            Err(SettleError::Onchain(_)) => {
                error!(
                    maker_intent = maker.db_intent_id,
                    taker_intent = taker.db_intent_id,
                    "settleMatch on-chain failure; keeping fill in pending queue for retry"
                );
                out.push(BatchSettleResult::TransientFailure);
            }
            Err(SettleError::OiGate(_)) => {
                // Non-CapBreach OI gate error (e.g. RPC during gate read).
                // Treat as transient — the next tick may succeed.
                error!(
                    maker_intent = maker.db_intent_id,
                    taker_intent = taker.db_intent_id,
                    "OI gate read failed (transient); keeping fill in pending queue"
                );
                out.push(BatchSettleResult::TransientFailure);
            }
            Err(e) => {
                error!(
                    maker_intent = maker.db_intent_id,
                    taker_intent = taker.db_intent_id,
                    error = ?e,
                    "settleMatch permanent failure; dropping fill"
                );
                out.push(BatchSettleResult::PermanentFailure);
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// matcher-types SignedOrder → onchain bindings SignedOrder
// ---------------------------------------------------------------------------

fn to_onchain_signed(
    src: &bufi_matcher_types::eip712::SignedOrder,
) -> bufi_perps_onchain::bindings::SignedOrder {
    bufi_perps_onchain::bindings::SignedOrder {
        trader: src.trader,
        marketId: src.marketId,
        sizeDeltaE18: src.sizeDeltaE18,
        priceE18: src.priceE18,
        maxFee: src.maxFee,
        orderType: src.orderType,
        flags: src.flags,
        nonce: src.nonce,
        deadline: src.deadline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_delta_long_positive_short_negative() {
        assert_eq!(signed_delta_for_side(Side::Long, 100), 100);
        assert_eq!(signed_delta_for_side(Side::Short, 100), -100);
    }
}
