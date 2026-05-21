//! Runtime invariant checks.
//!
//! Each function corresponds to a row in the invariants table in
//! `docs/matcher-architecture.md` §Critical invariants. They're cheap enough
//! to run in `debug_assert!` form inside the match loop and provide the
//! property-test surface for `proptest`.
//!
//! Phase 1: declarations only. Real implementations + tests land alongside
//! the Phase 2 match loop.

use crate::book::OrderBook;

/// Invariant 3: `best_bid_price < best_ask_price` after every match.
///
/// Returns `true` when the book is uncrossed (or empty on either side).
pub fn book_is_uncrossed(book: &OrderBook) -> bool {
    use crate::order::Side;
    let best_bid = book.bids.peek_best(Side::Long).map(|(p, _)| p);
    let best_ask = book.asks.peek_best(Side::Short).map(|(p, _)| p);
    match (best_bid, best_ask) {
        (Some(b), Some(a)) => b.raw() < a.raw(),
        _ => true,
    }
}
