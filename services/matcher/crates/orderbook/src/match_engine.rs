//! Price-time-priority match loop.
//!
//! Phase 1: stubbed. The real implementation lands in Phase 2.
//! See `docs/matcher-architecture.md` §Matching algorithm and
//! `docs/matcher-reading-notes.md` §Source 3 for the structural template.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::book::OrderBook;
use crate::order::{Fill, Intent};

/// Outcome of a match attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchOutcome {
    /// Fills produced.
    pub fills: Vec<Fill>,
    /// What happened — filled, partial, rested, or rejected.
    pub status: MatchStatus,
    /// Populated only when status = `Rejected`.
    pub reject_reason: Option<RejectReason>,
}

/// Match result status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchStatus {
    /// Fully filled.
    Filled,
    /// Partially filled (some fills produced, but residual could not match).
    Partial,
    /// Rested on the book without any fill.
    Resting,
    /// Rejected — see `RejectReason`.
    Rejected,
}

/// Reasons a match can be rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum RejectReason {
    /// Intent passed the matcher with `expires_at_ms <= now_ms`.
    #[error("intent expired before match")]
    Expired,
    /// FOK intent could not be fully filled on `peek_match`.
    #[error("fill-or-kill: insufficient liquidity to fully match")]
    FokInsufficientLiquidity,
    /// IOC intent with no resting liquidity on the opposite side.
    #[error("immediate-or-cancel: no matching liquidity")]
    IocNoLiquidity,
    /// Zero-size intent.
    #[error("intent has zero size")]
    ZeroSize,
    /// Limit-price was zero or otherwise invalid.
    #[error("invalid limit price")]
    InvalidLimitPrice,
}

/// Match an intent against `book` at `now_ms`.
///
/// **Phase 1 — stubbed.** Always returns `Resting` without touching the book.
/// Real implementation lands in Phase 2 with invariants 1-8 tested.
pub fn match_intent(_book: &mut OrderBook, _intent: Intent, _now_ms: u64) -> MatchOutcome {
    MatchOutcome {
        fills: Vec::new(),
        status: MatchStatus::Resting,
        reject_reason: None,
    }
}

/// Non-mutating peek: would the intent fully fill at `now_ms`?
///
/// Used by FOK to avoid rollback. Phase 1 stub — returns false.
/// Real implementation walks the opposite side without mutating it.
pub fn peek_match(_book: &OrderBook, _intent: &Intent, _now_ms: u64) -> bool {
    false
}
