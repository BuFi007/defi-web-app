//! Price-time-priority match loop.
//!
//! Pure functions. `now_ms` is passed in; the engine never reads the clock.
//! Adopted from joaquinbejar/OrderBook-rs structural template
//! (see `docs/matcher-reading-notes.md` §Source 3).
//!
//! ## Algorithm (Phase 2 — no LP yet)
//!
//! 1. Validate inputs: expiry, zero size, zero limit price (for limits).
//! 2. If TIF=FOK, run `peek_match`. If it returns false, reject without
//!    touching the book — this avoids the rollback complexity Polymarket
//!    works around.
//! 3. Walk the opposite side best-first. For each maker the taker crosses,
//!    pop the FIFO front, derive the fill, decrement both sides.
//! 4. Handle residual per TIF: GTC rests, IOC drops, FOK already handled.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::book::OrderBook;
use crate::order::{Fill, Intent, IntentId, Order, OrderType, Side, TimeInForce};
use crate::price::{Price, Size};

/// Outcome of a match attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchOutcome {
    /// The intent that was matched (id only — full payload lives elsewhere).
    pub intent_id: IntentId,
    /// Fills produced, in execution order.
    pub fills: Vec<Fill>,
    /// Disposition of the intent.
    pub status: MatchStatus,
    /// Populated only when `status = Rejected`.
    pub reject_reason: Option<RejectReason>,
    /// Size remaining on the taker side after the match (0 if fully filled
    /// or dropped under IOC).
    pub residual: Size,
}

/// Match result status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchStatus {
    /// Fully filled — no residual.
    Filled,
    /// Some fills produced; residual either rests (GTC) or was dropped (IOC).
    Partial,
    /// No fills; intent rested on the book (GTC only).
    Resting,
    /// Rejected — see `reject_reason`.
    Rejected,
}

/// Reasons a match can be rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum RejectReason {
    /// `expires_at_ms <= now_ms`.
    #[error("intent expired before match")]
    Expired,
    /// FOK could not be fully filled on `peek_match`.
    #[error("fill-or-kill: insufficient liquidity to fully match")]
    FokInsufficientLiquidity,
    /// Zero-magnitude intent.
    #[error("intent has zero size")]
    ZeroSize,
    /// Limit price was zero or otherwise invalid.
    #[error("invalid limit price")]
    InvalidLimitPrice,
    /// IOC with no resting liquidity that crossed.
    #[error("immediate-or-cancel: no matching liquidity")]
    IocNoLiquidity,
}

/// Outcome of a cancel attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelOutcome {
    /// The intent id targeted.
    pub intent_id: IntentId,
    /// Result status.
    pub status: CancelStatus,
    /// Magnitude remaining on book at cancel time (0 if not found / filled).
    pub residual: Size,
}

/// Cancellation status — mirrors the proto enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CancelStatus {
    /// Order was on the book and is now removed.
    Canceled,
    /// Intent id was unknown (already filled, never rested, or never seen).
    NotFound,
    /// Order existed but was fully filled before this cancel arrived.
    /// (Today indistinguishable from `NotFound` in the orderbook; the
    /// matcher-server layer disambiguates via the fill log.)
    AlreadyFilled,
}

/// Match an intent against `book` at `now_ms`.
///
/// Determinism: with identical `(book, intent, now_ms, match_seq)`, this
/// function returns byte-identical `MatchOutcome` every call.
pub fn match_intent(
    book: &mut OrderBook,
    intent: Intent,
    now_ms: u64,
    match_seq: u64,
) -> MatchOutcome {
    // ---------- (1) input validation ----------
    if let Some(reason) = validate(&intent, now_ms) {
        return MatchOutcome {
            intent_id: intent.id,
            fills: Vec::new(),
            status: MatchStatus::Rejected,
            reject_reason: Some(reason),
            residual: intent.magnitude,
        };
    }

    // ---------- (2) FOK peek-then-execute ----------
    if matches!(intent.tif, TimeInForce::FillOrKill) && !peek_match(book, &intent, now_ms) {
        return MatchOutcome {
            intent_id: intent.id,
            fills: Vec::new(),
            status: MatchStatus::Rejected,
            reject_reason: Some(RejectReason::FokInsufficientLiquidity),
            residual: intent.magnitude,
        };
    }

    // ---------- (3) walk opposite side best-first ----------
    let mut remaining = intent.magnitude;
    let mut fills = Vec::new();
    let mut fill_seq = 0u64;

    loop {
        if remaining.is_zero() {
            break;
        }
        let opposite = intent.side.opposite();
        let Some((best_price, _)) = book.side(opposite).peek_best(opposite) else {
            break;
        };
        if !taker_crosses(intent.side, intent.order_type, intent.price, best_price) {
            break;
        }

        let Some(mut maker) = book.side_mut(opposite).pop_front_at(best_price) else {
            break;
        };

        let fill_size = Size::new(remaining.raw().min(maker.remaining.raw()));
        fills.push(make_fill(
            intent.market_id,
            intent.id,
            &maker,
            intent.side,
            fill_size,
            now_ms,
            match_seq,
            fill_seq,
        ));
        fill_seq += 1;

        remaining = remaining.saturating_sub(fill_size);
        maker.remaining = maker.remaining.saturating_sub(fill_size);

        if maker.remaining.is_zero() {
            book.drop_from_index(maker.id);
        } else {
            // Maker still has size — return to the front of its level.
            book.side_mut(opposite).push_front_at(best_price, maker);
        }
    }

    // ---------- (4) residual handling per TIF ----------
    let status = if remaining.is_zero() {
        MatchStatus::Filled
    } else if !fills.is_empty() {
        match intent.tif {
            TimeInForce::GoodTilCancel => {
                let residual_order = Order::from_intent_residual(&intent, remaining, now_ms);
                book.insert(residual_order);
                MatchStatus::Partial
            }
            TimeInForce::ImmediateOrCancel => MatchStatus::Partial,
            TimeInForce::FillOrKill => {
                debug_assert!(false, "FOK reaching residual handling means peek lied");
                MatchStatus::Partial
            }
        }
    } else {
        // No fills produced.
        match intent.tif {
            TimeInForce::GoodTilCancel => {
                // Market orders with no liquidity drop on the floor instead of
                // resting — a resting market order would re-execute at any price.
                if matches!(intent.order_type, OrderType::Market) {
                    return MatchOutcome {
                        intent_id: intent.id,
                        fills,
                        status: MatchStatus::Rejected,
                        reject_reason: Some(RejectReason::IocNoLiquidity),
                        residual: remaining,
                    };
                }
                let residual_order = Order::from_intent_residual(&intent, remaining, now_ms);
                book.insert(residual_order);
                MatchStatus::Resting
            }
            TimeInForce::ImmediateOrCancel => {
                return MatchOutcome {
                    intent_id: intent.id,
                    fills,
                    status: MatchStatus::Rejected,
                    reject_reason: Some(RejectReason::IocNoLiquidity),
                    residual: remaining,
                };
            }
            TimeInForce::FillOrKill => MatchStatus::Rejected,
        }
    };

    MatchOutcome {
        intent_id: intent.id,
        fills,
        status,
        reject_reason: None,
        residual: remaining,
    }
}

/// Non-mutating peek: would the intent fully fill at `now_ms`?
///
/// Used by FOK to avoid the rollback path Polymarket's `matchOrders` has.
pub fn peek_match(book: &OrderBook, intent: &Intent, _now_ms: u64) -> bool {
    let opposite = intent.side.opposite();
    let mut remaining = intent.magnitude;
    for (price, queue) in book.side(opposite).iter_for_taker(intent.side) {
        if !taker_crosses(intent.side, intent.order_type, intent.price, price) {
            return false;
        }
        for maker in queue {
            let take = Size::new(remaining.raw().min(maker.remaining.raw()));
            remaining = remaining.saturating_sub(take);
            if remaining.is_zero() {
                return true;
            }
        }
    }
    remaining.is_zero()
}

/// Cancel a resting order by intent id.
///
/// Idempotent: cancelling an unknown id returns `NotFound` rather than
/// erroring. The matcher-server layer distinguishes `NotFound` from
/// `AlreadyFilled` via its fill log.
pub fn cancel_intent(book: &mut OrderBook, intent_id: IntentId) -> CancelOutcome {
    match book.cancel(intent_id) {
        Some(removed) => CancelOutcome {
            intent_id,
            status: CancelStatus::Canceled,
            residual: removed.remaining,
        },
        None => CancelOutcome {
            intent_id,
            status: CancelStatus::NotFound,
            residual: Size::new(0),
        },
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn validate(intent: &Intent, now_ms: u64) -> Option<RejectReason> {
    if intent.magnitude.is_zero() {
        return Some(RejectReason::ZeroSize);
    }
    if matches!(intent.order_type, OrderType::Limit) && intent.price.raw() <= 0 {
        return Some(RejectReason::InvalidLimitPrice);
    }
    // `deadline_secs` is unix seconds; convert `now_ms` accordingly.
    let now_secs = now_ms / 1_000;
    if intent.deadline_secs <= now_secs {
        return Some(RejectReason::Expired);
    }
    None
}

fn taker_crosses(taker: Side, order_type: OrderType, limit: Price, best: Price) -> bool {
    match order_type {
        // Market orders cross every level on the opposite side that has volume.
        OrderType::Market => true,
        OrderType::Limit => match taker {
            Side::Long => limit.raw() >= best.raw(),
            Side::Short => limit.raw() <= best.raw(),
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn make_fill(
    market_id: crate::order::MarketId,
    taker_id: IntentId,
    maker: &Order,
    taker_side: Side,
    size: Size,
    now_ms: u64,
    match_seq: u64,
    fill_seq: u64,
) -> Fill {
    Fill {
        fill_id: derive_fill_id(maker.id, taker_id, match_seq, fill_seq),
        maker_intent_id: maker.id,
        taker_intent_id: taker_id,
        market_id,
        taker_side,
        price: maker.price,
        size,
        timestamp_ms: now_ms,
        is_lp_fill: false,
    }
}

/// Deterministic fill id derived from inputs only — never RNG, never clock.
/// Format: 8B match_seq || 8B fill_seq || 8B truncated maker || 8B truncated taker.
/// This is enough entropy for goldens to be stable; a real keccak hash lands
/// in matcher-server (it has access to alloy primitives).
fn derive_fill_id(
    maker_id: IntentId,
    taker_id: IntentId,
    match_seq: u64,
    fill_seq: u64,
) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[0..8].copy_from_slice(&match_seq.to_be_bytes());
    out[8..16].copy_from_slice(&fill_seq.to_be_bytes());
    out[16..24].copy_from_slice(&maker_id[..8]);
    out[24..32].copy_from_slice(&taker_id[..8]);
    out
}
