// `1 * ONE_E18` reads as "one unit" — keep the consistency with the unit suite.
#![allow(clippy::identity_op)]

//! Property tests for the matcher invariants.
//!
//! Each property corresponds to a row in
//! `docs/matcher-architecture.md` §Critical invariants table:
//!
//! 1. Intent never fills more than declared size.
//! 2. Same price level: earlier arrival fills first (FIFO).
//! 3. `best_bid_price < best_ask_price` after every match.
//! 4. Conservation: Σ fill_sizes + remaining_on_book ≤ original_size.
//! 5. Replay determinism: same input sequence → byte-identical fills.
//! 6. No fill with `price = 0` or `size = 0`.
//! 7. Cancel of already-filled intent is a no-op, not an error.
//! 8. Expired intent never matches.

mod common;

use bufi_orderbook::{
    cancel_intent, match_intent, CancelStatus, MatchOutcome, OrderBook, Side, Size, TimeInForce,
};
use common::{book_with, intent, intent_id, maker, ONE_E18, TEST_MARKET};
use proptest::prelude::*;

const NOW_MS: u64 = 2_000_000_000_000;
const NOW_SECS: u64 = NOW_MS / 1_000;

/// Generator for a sequence of `(price_e18, size_e18, side)` triples that
/// seed a book. Prices kept in a sane range so multi-level walks have
/// real meaning.
fn book_strategy() -> impl Strategy<Value = Vec<(i128, u128, Side)>> {
    prop::collection::vec(
        (
            (1i128..=10).prop_map(|p| p * ONE_E18),
            (1u128..=10).prop_map(|s| s * ONE_E18 as u128),
            prop_oneof![Just(Side::Long), Just(Side::Short)],
        ),
        0..20,
    )
}

fn seed_book(orders: &[(i128, u128, Side)]) -> OrderBook {
    let mut makers = Vec::with_capacity(orders.len());
    for (i, (price, size, side)) in orders.iter().enumerate() {
        // Use i+1 as the id seed so 0x00-id (which we use for takers) is free.
        makers.push(maker(
            (i as u8).wrapping_add(0x40),
            (i as u8).wrapping_add(0x80),
            *side,
            *price,
            *size,
            100 + i as u64,
        ));
    }
    let mut book = book_with(makers);
    // Some random combinations would seed a crossed book — fix it by
    // dropping any ask priced at or below any bid.
    uncross(&mut book);
    book
}

/// Drop the worst-priced bid until the book is uncrossed. Defensive helper
/// for fixture-seeding; the matcher itself never produces a crossed book.
fn uncross(book: &mut OrderBook) {
    use bufi_orderbook::Price;
    loop {
        let best_bid: Option<Price> = book.bids.peek_best(Side::Long).map(|(p, _)| p);
        let best_ask: Option<Price> = book.asks.peek_best(Side::Short).map(|(p, _)| p);
        let (Some(b), Some(a)) = (best_bid, best_ask) else { return };
        if b.raw() < a.raw() {
            return;
        }
        if let Some(order) = book.bids.pop_front_at(b) {
            book.drop_from_index(order.id);
        } else {
            return;
        }
    }
}

proptest! {
    /// Invariant 1 + 4: each fill ≤ declared size, and Σfills + residual = original.
    #[test]
    fn invariant_1_and_4_size_conservation(seed in book_strategy(), magnitude_e18 in 1u128..=20) {
        let mut book = seed_book(&seed);
        let take_magnitude = magnitude_e18 * (ONE_E18 as u128);
        let taker = intent(0x01, 0x20, Side::Long, 100 * ONE_E18, take_magnitude, 1, NOW_SECS);
        let result = match_intent(&mut book, taker, NOW_MS, 0);

        // No single fill exceeds the declared magnitude (invariant 1).
        for fill in &result.fills {
            prop_assert!(fill.size.raw() <= take_magnitude);
        }
        // Σfills + residual = original (invariant 4).
        let summed: u128 = result.fills.iter().map(|f| f.size.raw()).sum();
        prop_assert_eq!(summed.saturating_add(result.residual.raw()), take_magnitude);
    }

    /// Invariant 3: best_bid < best_ask after every match.
    #[test]
    fn invariant_3_book_never_crosses(seed in book_strategy(), price_e18 in 1i128..=10) {
        let mut book = seed_book(&seed);
        let limit = price_e18 * ONE_E18;
        let taker = intent(0x01, 0x20, Side::Long, limit, 5 * ONE_E18 as u128, 1, NOW_SECS);
        let _ = match_intent(&mut book, taker, NOW_MS, 0);

        let best_bid = book.bids.peek_best(Side::Long).map(|(p, _)| p.raw());
        let best_ask = book.asks.peek_best(Side::Short).map(|(p, _)| p.raw());
        if let (Some(b), Some(a)) = (best_bid, best_ask) {
            prop_assert!(b < a, "book crossed: best_bid={b}, best_ask={a}");
        }
    }

    /// Invariant 5: same input sequence → byte-identical fills + residuals.
    #[test]
    fn invariant_5_replay_determinism(seed in book_strategy(), magnitude_e18 in 1u128..=20) {
        let mut book_a = seed_book(&seed);
        let mut book_b = seed_book(&seed);
        let take = magnitude_e18 * (ONE_E18 as u128);
        let intent_a = intent(0x01, 0x20, Side::Long, 100 * ONE_E18, take, 1, NOW_SECS);
        let intent_b = intent_a.clone();
        let out_a = match_intent(&mut book_a, intent_a, NOW_MS, 7);
        let out_b = match_intent(&mut book_b, intent_b, NOW_MS, 7);
        prop_assert_eq!(out_a, out_b);
    }

    /// Invariant 6: no fill carries price=0 or size=0.
    #[test]
    fn invariant_6_no_zero_fills(seed in book_strategy(), magnitude_e18 in 1u128..=20) {
        let mut book = seed_book(&seed);
        let taker = intent(
            0x01,
            0x20,
            Side::Long,
            100 * ONE_E18,
            magnitude_e18 * ONE_E18 as u128,
            1,
            NOW_SECS,
        );
        let result = match_intent(&mut book, taker, NOW_MS, 0);
        for fill in &result.fills {
            prop_assert!(fill.size.raw() > 0, "zero-size fill produced");
            prop_assert!(fill.price.raw() > 0, "zero-price fill produced");
        }
    }

    /// Invariant 7: cancel of an already-filled (or unknown) intent is a
    /// no-op, returning a typed status — never an error.
    #[test]
    fn invariant_7_cancel_after_fill_is_noop(seed in book_strategy()) {
        let mut book = seed_book(&seed);
        // Submit a sweeping IOC taker, then try to cancel it.
        let mut taker = intent(
            0x01,
            0x20,
            Side::Long,
            100 * ONE_E18,
            50 * ONE_E18 as u128,
            1,
            NOW_SECS,
        );
        taker.tif = TimeInForce::ImmediateOrCancel;
        let _ = match_intent(&mut book, taker, NOW_MS, 0);

        // The taker never rests (IOC), so cancel returns NotFound — not an error.
        let result = cancel_intent(&mut book, intent_id(0x01));
        prop_assert_eq!(result.status, CancelStatus::NotFound);
        prop_assert_eq!(result.residual, Size::new(0));
    }

    /// Invariant 8: an expired intent never produces a fill and never rests.
    #[test]
    fn invariant_8_expired_never_matches(seed in book_strategy()) {
        let mut book = seed_book(&seed);
        let original_bids = book.bids.total_size();
        let original_asks = book.asks.total_size();

        let mut taker = intent(
            0x01,
            0x20,
            Side::Long,
            100 * ONE_E18,
            5 * ONE_E18 as u128,
            1,
            NOW_SECS,
        );
        taker.deadline_secs = NOW_SECS - 1;
        let result: MatchOutcome = match_intent(&mut book, taker, NOW_MS, 0);

        prop_assert!(result.fills.is_empty());
        prop_assert_eq!(book.bids.total_size(), original_bids);
        prop_assert_eq!(book.asks.total_size(), original_asks);
    }
}

/// Invariant 2: at a single price level, earlier insertion fills first.
/// Deterministic — not randomised, since FIFO is exact.
#[test]
fn invariant_2_fifo_at_same_price() {
    use bufi_orderbook::OrderBook;
    let mut book = OrderBook::new(TEST_MARKET);
    // Insert three asks at the same price, ids in order 0xAA, 0xBB, 0xCC.
    book.insert(maker(0xAA, 0x10, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 100));
    book.insert(maker(0xBB, 0x11, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 200));
    book.insert(maker(0xCC, 0x12, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 300));

    // A taker that eats one unit must fill against 0xAA.
    let taker = intent(0x01, 0x20, Side::Long, ONE_E18, 1 * ONE_E18 as u128, 1, NOW_SECS);
    let r1 = match_intent(&mut book, taker, NOW_MS, 0);
    assert_eq!(r1.fills[0].maker_intent_id, intent_id(0xAA));

    // Next taker hits 0xBB.
    let taker = intent(0x02, 0x21, Side::Long, ONE_E18, 1 * ONE_E18 as u128, 2, NOW_SECS);
    let r2 = match_intent(&mut book, taker, NOW_MS, 1);
    assert_eq!(r2.fills[0].maker_intent_id, intent_id(0xBB));

    // Third hits 0xCC.
    let taker = intent(0x03, 0x22, Side::Long, ONE_E18, 1 * ONE_E18 as u128, 3, NOW_SECS);
    let r3 = match_intent(&mut book, taker, NOW_MS, 2);
    assert_eq!(r3.fills[0].maker_intent_id, intent_id(0xCC));
}
