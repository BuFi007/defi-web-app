//! BUFI matcher orderbook core.
//!
//! Pure functions, no IO, no time, no RNG, no floats. Anything that smells of
//! the outside world lives in `matcher-server`. This crate is the audit
//! surface — every public function must be deterministic given identical
//! inputs (including the `now_ms` parameter).
//!
//! See `docs/matcher-architecture.md` §Determinism contract for the full
//! list of invariants this crate is responsible for.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod book;
pub mod invariants;
pub mod lp;
pub mod lp_gate;
pub mod match_engine;
pub mod order;
pub mod price;

pub use book::{OrderBook, OrderBookSide};
pub use lp::{
    check_basic_gate, check_delta_cap, quote_price, spread_bps, LpConfig, LpDeny, LpSnapshot,
    LpStateView,
};
pub use lp_gate::{pure_check, LpGateDeny, LpQuote, OiView, OracleView, ORACLE_MAX_AGE_SECS};
pub use match_engine::{
    cancel_intent, match_intent, peek_match, CancelOutcome, CancelStatus, MatchOutcome,
    MatchStatus, RejectReason,
};
pub use order::{
    Fill, Intent, IntentId, MarketId, Order, OrderType, Side, TimeInForce, FLAG_POST_ONLY,
    FLAG_REDUCE_ONLY,
};
pub use price::{Price, Size, PRICE_DECIMALS, SIZE_DECIMALS};
